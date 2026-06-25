from sqlalchemy.orm import Session, joinedload
from sqlalchemy import or_, and_, desc, func
from datetime import datetime
from typing import Optional, List, Tuple
import json

from backend.app.models import Article, Cluster, ClusterArticle, Job
from backend.app.schemas import ArticleCreate, ClusterCreate

# ----------------- ARTICLE CRUD -----------------

def get_article(db: Session, article_id: int) -> Optional[Article]:
    return db.query(Article).filter(Article.id == article_id).first()

def get_article_by_hash(db: Session, article_hash: str) -> Optional[Article]:
    return db.query(Article).filter(Article.hash == article_hash).first()

def get_article_by_url(db: Session, url: str) -> Optional[Article]:
    return db.query(Article).filter(Article.url == url).first()

def get_articles(db: Session, skip: int = 0, limit: int = 100) -> List[Article]:
    return db.query(Article).order_by(desc(Article.published_at)).offset(skip).limit(limit).all()

def get_articles_count(db: Session) -> int:
    return db.query(func.count(Article.id)).scalar() or 0

def create_article(db: Session, article_in: ArticleCreate) -> Article:
    db_article = Article(
        title=article_in.title,
        content=article_in.content,
        summary=article_in.summary,
        url=article_in.url,
        source=article_in.source,
        author=article_in.author,
        published_at=article_in.published_at,
        hash=article_in.hash
    )
    db.add(db_article)
    db.commit()
    db.refresh(db_article)
    return db_article

# ----------------- CLUSTER CRUD -----------------

def get_cluster(db: Session, cluster_id: int) -> Optional[Cluster]:
    return db.query(Cluster).options(
        joinedload(Cluster.article_associations).joinedload(ClusterArticle.article)
    ).filter(Cluster.id == cluster_id).first()

def get_clusters(
    db: Session, 
    search: Optional[str] = None,
    start_date: Optional[datetime] = None,
    end_date: Optional[datetime] = None,
    skip: int = 0,
    limit: int = 20,
    is_active: bool = True
) -> Tuple[List[Cluster], int]:
    # Query with eager loading of articles to avoid N+1 query problem
    query = db.query(Cluster).options(
        joinedload(Cluster.article_associations).joinedload(ClusterArticle.article)
    ).filter(Cluster.is_active == is_active)
    
    # Text Search Filter
    if search:
        search_pattern = f"%{search}%"
        # Search in cluster title, description, keywords, or inside associated article titles
        query = query.join(Cluster.article_associations).join(ClusterArticle.article).filter(
            or_(
                Cluster.title.like(search_pattern),
                Cluster.description.like(search_pattern),
                Cluster.representative_keywords.like(search_pattern),
                Article.title.like(search_pattern)
            )
        ).distinct()
        
    # Date Range Filter
    if start_date or end_date:
        query = query.join(Cluster.article_associations).join(ClusterArticle.article)
        if start_date:
            query = query.filter(Article.published_at >= start_date)
        if end_date:
            query = query.filter(Article.published_at <= end_date)
        query = query.distinct()

    # Sort clusters: we sort by the publication date of their latest article
    # We can do this in Python or via SQL. An outer join and grouping or subquery handles it in SQL.
    # To keep it simple and high-performing, we can use a subquery to select clusters sorted by maximum article publication date.
    subquery = (
        db.query(
            ClusterArticle.cluster_id, 
            func.max(Article.published_at).label("latest_pub")
        )
        .join(Article, ClusterArticle.article_id == Article.id)
        .group_by(ClusterArticle.cluster_id)
        .subquery()
    )
    
    # Join with subquery to order by latest_pub
    ordered_query = query.outerjoin(subquery, Cluster.id == subquery.c.cluster_id).order_by(
        desc(subquery.c.latest_pub),
        desc(Cluster.created_at)
    )

    # Get total count before slicing
    total = ordered_query.count()
    
    # Execute paginated query
    results = ordered_query.offset(skip).limit(limit).all()
    
    return results, total

def create_cluster(db: Session, title: str, description: Optional[str] = None, keywords: List[str] = []) -> Cluster:
    db_cluster = Cluster(
        title=title,
        description=description,
        representative_keywords=json.dumps(keywords),
        is_active=True
    )
    db.add(db_cluster)
    db.commit()
    db.refresh(db_cluster)
    return db_cluster

def add_article_to_cluster(db: Session, cluster_id: int, article_id: int, similarity_score: float) -> ClusterArticle:
    # Check if link already exists
    link = db.query(ClusterArticle).filter(
        ClusterArticle.cluster_id == cluster_id,
        ClusterArticle.article_id == article_id
    ).first()
    if link:
        return link
        
    db_link = ClusterArticle(
        cluster_id=cluster_id,
        article_id=article_id,
        similarity_score=similarity_score
    )
    db.add(db_link)
    db.commit()
    db.refresh(db_link)
    return db_link

# ----------------- JOB CRUD -----------------

def create_job(db: Session) -> Job:
    db_job = Job(status="running")
    db.add(db_job)
    db.commit()
    db.refresh(db_job)
    return db_job

def update_job_status(
    db: Session, 
    job_id: int, 
    status: str, 
    articles_fetched: int = 0, 
    articles_clustered: int = 0, 
    error_log: Optional[str] = None
) -> Optional[Job]:
    db_job = db.query(Job).filter(Job.id == job_id).first()
    if not db_job:
        return None
        
    db_job.status = status
    db_job.articles_fetched = articles_fetched
    db_job.articles_clustered = articles_clustered
    db_job.completed_at = func.now()
    if error_log:
        db_job.error_log = error_log
        
    db.commit()
    db.refresh(db_job)
    return db_job

def get_jobs(db: Session, limit: int = 20) -> List[Job]:
    return db.query(Job).order_by(desc(Job.started_at)).limit(limit).all()

def get_latest_job(db: Session) -> Optional[Job]:
    return db.query(Job).order_by(desc(Job.started_at)).first()
