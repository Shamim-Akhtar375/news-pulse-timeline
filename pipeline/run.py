import os
import sys
import traceback
from datetime import datetime
import logging

# Add current working directory to path to allow absolute imports
sys.path.append(os.getcwd())

from backend.app.database import engine, Base, SessionLocal
from backend.app.config import settings
from backend.app import crud
from backend.app.schemas import ArticleCreate
from pipeline.ingestion import fetch_feed_articles, fetch_full_text
from pipeline.clustering import run_clustering_pipeline

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s"
)
logger = logging.getLogger("news_pulse.pipeline")

def run_pipeline() -> dict:
    """Executes the full News Ingestion and Clustering pipeline.
    
    1. Standardizes/creates database tables.
    2. Logs a new Job record.
    3. Ingests all articles from configured RSS feeds.
    4. Scrapes full body text for new/unseen articles.
    5. Re-clusters the corpus.
    6. Updates Job record with statistics.
    """
    logger.info("Starting pipeline execution run...")
    
    # 1. Initialize database tables if they do not exist
    Base.metadata.create_all(bind=engine)
    
    db = SessionLocal()
    
    # 2. Register job in database
    job = crud.create_job(db)
    
    articles_fetched_count = 0
    articles_clustered_count = 0
    
    try:
        # 3. Fetch feeds and parse entries
        feeds = settings.RSS_FEEDS
        logger.info(f"Ingesting from {len(feeds)} RSS feeds...")
        
        all_normalized_entries = []
        for feed_url in feeds:
            try:
                entries = fetch_feed_articles(feed_url)
                all_normalized_entries.extend(entries)
            except Exception as e:
                logger.error(f"Error parsing feed {feed_url}: {str(e)}")
                # Continue to next feed
                continue
                
        logger.info(f"Ingestion parsed {len(all_normalized_entries)} total entries from all feeds.")
        
        # 4. Scrape full body texts for new articles
        new_articles_saved = 0
        for entry in all_normalized_entries:
            # Check if article already exists by hash or url
            existing_by_hash = crud.get_article_by_hash(db, entry["hash"])
            existing_by_url = crud.get_article_by_url(db, entry["url"])
            
            if existing_by_hash or existing_by_url:
                # Deduplication check passed: skip scraping
                continue
                
            # Scrape full text of the article
            try:
                # Fetch full text
                full_text = fetch_full_text(entry["url"])
                
                if not full_text:
                    # Skip if text is empty or blocked
                    logger.warning(f"Skipping article {entry['title']} due to empty scraped content.")
                    continue
                    
                entry["content"] = full_text
                
                # Write to database
                article_in = ArticleCreate(**entry)
                crud.create_article(db, article_in)
                new_articles_saved += 1
                articles_fetched_count += 1
                
            except Exception as e:
                # Log individual failures but continue processing the remaining feed entries
                logger.error(f"Failed to ingest individual article {entry['title']}: {str(e)}")
                continue
                
        logger.info(f"Ingested and saved {new_articles_saved} new articles.")
        
        # 5. Run clustering
        # Re-run clustering if we added new articles or if we have no clusters yet
        total_clusters = run_clustering_pipeline(db)
        articles_clustered_count = db.query(crud.Article).count()
        
        # 6. Mark job as complete
        crud.update_job_status(
            db=db,
            job_id=job.id,
            status="completed",
            articles_fetched=articles_fetched_count,
            articles_clustered=articles_clustered_count
        )
        
        logger.info("Pipeline execution completed successfully.")
        return {
            "status": "completed",
            "articles_fetched": articles_fetched_count,
            "articles_clustered": articles_clustered_count,
            "clusters_created": total_clusters
        }
        
    except Exception as e:
        error_msg = f"{str(e)}\n{traceback.format_exc()}"
        logger.error(f"Pipeline crashed during execution: {error_msg}")
        
        # Mark job as failed
        crud.update_job_status(
            db=db,
            job_id=job.id,
            status="failed",
            articles_fetched=articles_fetched_count,
            articles_clustered=articles_clustered_count,
            error_log=error_msg
        )
        
        return {
            "status": "failed",
            "error": str(e)
        }
    finally:
        db.close()

if __name__ == "__main__":
    run_pipeline()
