from fastapi import FastAPI, Depends, HTTPException, BackgroundTasks, Query
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy.orm import Session
from datetime import datetime
import logging
from typing import Optional, List

from backend.app.database import engine, Base, get_db
from backend.app.config import settings
from backend.app import crud, schemas
from pipeline.run import run_pipeline

# Initialize logger
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s"
)
logger = logging.getLogger("news_pulse.api")

# Auto-create tables (this simplifies setup during development)
try:
    Base.metadata.create_all(bind=engine)
    logger.info("Database tables initialized successfully.")
except Exception as e:
    logger.error(f"Error creating database tables: {str(e)}")

app = FastAPI(
    title=settings.PROJECT_NAME,
    version=settings.VERSION,
    description="Backend API for News Pulse - RSS news aggregation, scraping, and similarity clustering."
)

# Configure CORS middleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # In production, specify actual frontend domain
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Global API Router / Root endpoint
@app.get("/api/health")
def health_check():
    return {"status": "healthy", "time": datetime.utcnow().isoformat()}

# ----------------- CLUSTER ENDPOINTS -----------------

@app.get("/api/clusters", response_model=schemas.PaginatedClustersResponse)
def read_clusters(
    search: Optional[str] = Query(None, description="Search term in cluster titles, keywords, or article titles"),
    start_date: Optional[datetime] = Query(None, description="Filter stories containing articles published on/after this UTC datetime"),
    end_date: Optional[datetime] = Query(None, description="Filter stories containing articles published on/before this UTC datetime"),
    page: int = Query(1, ge=1, description="Page number"),
    page_size: int = Query(20, ge=1, le=100, description="Items per page"),
    db: Session = Depends(get_db)
):
    """Retrieve all story clusters, ordered by the publication date of their latest article.
    Supports text search, date filtering, and pagination.
    """
    try:
        skip = (page - 1) * page_size
        db_clusters, total = crud.get_clusters(
            db=db,
            search=search,
            start_date=start_date,
            end_date=end_date,
            skip=skip,
            limit=page_size
        )
        return {
            "total": total,
            "page": page,
            "page_size": page_size,
            "items": db_clusters
        }
    except Exception as e:
        logger.error(f"Error reading clusters: {str(e)}")
        raise HTTPException(status_code=500, detail="Internal server error while retrieving clusters.")

@app.get("/api/clusters/{cluster_id}", response_model=schemas.ClusterResponse)
def read_cluster(cluster_id: int, db: Session = Depends(get_db)):
    """Retrieve a single cluster by ID with its nested articles and similarity scores."""
    db_cluster = crud.get_cluster(db, cluster_id=cluster_id)
    if not db_cluster:
        raise HTTPException(status_code=404, detail="Cluster not found.")
    return db_cluster

# ----------------- ARTICLE ENDPOINTS -----------------

@app.get("/api/articles", response_model=schemas.PaginatedArticlesResponse)
def read_articles(
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    db: Session = Depends(get_db)
):
    """Retrieve all articles ordered chronologically by publication date."""
    try:
        skip = (page - 1) * page_size
        db_articles = crud.get_articles(db, skip=skip, limit=page_size)
        total = crud.get_articles_count(db)
        
        return {
            "total": total,
            "page": page,
            "page_size": page_size,
            "items": db_articles
        }
    except Exception as e:
        logger.error(f"Error reading articles: {str(e)}")
        raise HTTPException(status_code=500, detail="Internal server error while retrieving articles.")

@app.get("/api/articles/{article_id}", response_model=schemas.ArticleResponse)
def read_article(article_id: int, db: Session = Depends(get_db)):
    """Retrieve a single article by its database ID."""
    db_article = crud.get_article(db, article_id=article_id)
    if not db_article:
        raise HTTPException(status_code=404, detail="Article not found.")
    return db_article

# ----------------- PIPELINE ENDPOINTS -----------------

def background_pipeline_task():
    """Wrapper function to invoke the ingestion and clustering pipeline in the background."""
    logger.info("Executing background pipeline job...")
    try:
        run_pipeline()
    except Exception as e:
        logger.error(f"Background pipeline execution failed: {str(e)}")

@app.post("/api/pipeline/run", status_code=202)
def trigger_pipeline(background_tasks: BackgroundTasks, db: Session = Depends(get_db)):
    """Triggers the RSS ingestion and ML clustering pipeline asynchronously.
    Returns status 202 Accepted immediately.
    """
    # Check if a job is currently running to prevent concurrent runs
    latest_job = crud.get_latest_job(db)
    if latest_job and latest_job.status == "running":
        # Check if it was started more than 10 minutes ago, in which case we consider it stalled
        time_elapsed = (datetime.utcnow() - latest_job.started_at).total_seconds()
        if time_elapsed < 600:
            return {"message": "Pipeline is already running.", "job_id": latest_job.id}
            
    background_tasks.add_task(background_pipeline_task)
    return {"message": "Pipeline ingestion and clustering triggered in background."}

@app.get("/api/pipeline/status", response_model=List[schemas.JobResponse])
def get_pipeline_status(limit: int = Query(10, ge=1, le=100), db: Session = Depends(get_db)):
    """Fetch status logs for the most recent pipeline runs."""
    try:
        jobs = crud.get_jobs(db, limit=limit)
        return jobs
    except Exception as e:
        logger.error(f"Error reading pipeline status: {str(e)}")
        raise HTTPException(status_code=500, detail="Internal server error retrieving pipeline status.")
