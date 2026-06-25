import json
import logging
import numpy as np
from typing import List, Dict, Any, Tuple
from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.metrics.pairwise import cosine_similarity
from sqlalchemy.orm import Session

from backend.app import crud
from backend.app.models import Article, Cluster, ClusterArticle
from backend.app.config import settings

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("news_pulse.clustering")

def build_article_corpus(articles: List[Article]) -> List[str]:
    """Combines article titles and content into a single document list for vectorization.
    We double-weight the title to ensure title terms influence the similarity strongly.
    """
    corpus = []
    for article in articles:
        # Boost title importance by duplicating it in the text body
        doc = f"{article.title} {article.title} {article.content or article.summary or ''}"
        corpus.append(doc)
    return corpus

def extract_top_keywords(
    vectorizer: TfidfVectorizer, 
    tfidf_matrix: np.ndarray, 
    article_indices: List[int], 
    top_n: int = 5
) -> List[str]:
    """Extracts the terms with the highest average TF-IDF weights within a specific group of articles."""
    if not article_indices:
        return []
        
    # Get the vectors for these articles
    sub_matrix = tfidf_matrix[article_indices]
    
    # Calculate the mean TF-IDF weight for each term across these articles
    mean_weights = np.asarray(sub_matrix.mean(axis=0)).flatten()
    
    # Get indices of top weights
    top_indices = mean_weights.argsort()[::-1][:top_n]
    
    # Map back to feature names (words)
    feature_names = vectorizer.get_feature_names_out()
    return [feature_names[i] for i in top_indices]

def find_central_article(
    similarity_matrix: np.ndarray, 
    article_indices: List[int]
) -> int:
    """Finds the article index that has the highest average similarity to all other articles in the cluster.
    This represents the 'centroid' or most central story.
    """
    if len(article_indices) <= 2:
        return article_indices[0]
        
    # Slice the similarity matrix to get similarity between cluster members
    sub_matrix = similarity_matrix[np.ix_(article_indices, article_indices)]
    
    # Sum similarities for each article (row-wise)
    similarity_sums = sub_matrix.sum(axis=1)
    
    # Index of maximum sum inside sub_matrix
    best_sub_idx = similarity_sums.argmax()
    
    return article_indices[best_sub_idx]

def perform_clustering(
    articles: List[Article], 
    threshold: float = 0.40
) -> List[Dict[str, Any]]:
    """Clusters articles using a deterministic, time-ordered agglomerative algorithm.
    Articles are sorted chronologically. Each article is assigned to the cluster of the
    most similar existing article if that similarity exceeds the threshold.
    Otherwise, a new cluster is created.
    """
    if not articles:
        return []
        
    # 1. Sort articles chronologically to guarantee deterministic results
    articles_sorted = sorted(articles, key=lambda x: x.published_at)
    
    # 2. Build corpus and fit TF-IDF vectorizer
    corpus = build_article_corpus(articles_sorted)
    vectorizer = TfidfVectorizer(
        stop_words="english",
        sublinear_tf=True,
        min_df=1,
        max_df=0.95
    )
    tfidf_matrix = vectorizer.fit_transform(corpus)
    
    # 3. Compute pairwise Cosine Similarity matrix
    sim_matrix = cosine_similarity(tfidf_matrix, tfidf_matrix)
    
    # 4. Chronological Agglomerative Clustering
    # List of clusters, each cluster is a dict: { "article_indices": [int], "id_list": [int] }
    clusters: List[Dict[str, Any]] = []
    
    for i, article in enumerate(articles_sorted):
        if not clusters:
            # First article creates the first cluster
            clusters.append({
                "article_indices": [i],
                "articles": [article]
            })
            continue
            
        # Find the most similar article among all previously processed articles
        best_sim = -1.0
        best_cluster_idx = -1
        
        # Compare with each existing cluster
        for c_idx, cluster in enumerate(clusters):
            # Find max similarity to any article in this cluster
            for member_idx in cluster["article_indices"]:
                sim = sim_matrix[i, member_idx]
                if sim > best_sim:
                    best_sim = sim
                    best_cluster_idx = c_idx
                    
        # Assign to the best cluster if it exceeds the threshold
        if best_sim >= threshold and best_cluster_idx != -1:
            clusters[best_cluster_idx]["article_indices"].append(i)
            clusters[best_cluster_idx]["articles"].append(article)
        else:
            # Create a new cluster
            clusters.append({
                "article_indices": [i],
                "articles": [article]
            })
            
    # 5. Extract Keywords, assign Titles, and format clusters
    results = []
    for cluster_idx, cluster in enumerate(clusters):
        member_indices = cluster["article_indices"]
        cluster_articles = cluster["articles"]
        
        # Extract top keywords using mean TF-IDF weights
        keywords = extract_top_keywords(vectorizer, tfidf_matrix, member_indices)
        
        # Find the central article index
        central_sorted_idx = find_central_article(sim_matrix, member_indices)
        central_article = articles_sorted[central_sorted_idx]
        
        # Title is designated as the title of the central article
        title = central_article.title
        
        # Description summarizes the cluster using its top keywords
        keywords_str = ", ".join(keywords)
        description = f"Story evolution centered around: {keywords_str}."
        
        results.append({
            "title": title,
            "description": description,
            "keywords": keywords,
            "articles": [
                (article, float(sim_matrix[sorted_idx, central_sorted_idx]))
                for sorted_idx, article in zip(member_indices, cluster_articles)
            ]
        })
        
    logger.info(f"Clustered {len(articles)} articles into {len(results)} distinct clusters.")
    return results

def run_clustering_pipeline(db: Session) -> int:
    """Fetches all articles, reclusters them, and updates the database.
    Re-clustering is transaction-safe. Old active clusters are deleted/archived,
    and new ones are written.
    """
    logger.info("Starting clustering pipeline run...")
    
    # Fetch all articles to cluster
    articles = db.query(Article).all()
    if not articles:
        logger.warning("No articles found in the database. Skipping clustering.")
        return 0
        
    # Clear existing clusters and associations to rebuild them cleanly
    # (Since this is a daily or on-demand cron, we update the state of the system completely)
    try:
        db.query(ClusterArticle).delete()
        db.query(Cluster).delete()
        db.commit()
    except Exception as e:
        db.rollback()
        logger.error(f"Failed to clear existing clusters: {str(e)}")
        raise e
        
    # Perform clustering
    threshold = settings.SIMILARITY_THRESHOLD
    clustered_results = perform_clustering(articles, threshold=threshold)
    
    # Save new clusters and associations to database
    clusters_created = 0
    for cluster_data in clustered_results:
        try:
            # Create cluster
            db_cluster = crud.create_cluster(
                db=db,
                title=cluster_data["title"],
                description=cluster_data["description"],
                keywords=cluster_data["keywords"]
            )
            
            # Link all articles
            for article, similarity_score in cluster_data["articles"]:
                crud.add_article_to_cluster(
                    db=db,
                    cluster_id=db_cluster.id,
                    article_id=article.id,
                    similarity_score=similarity_score
                )
                
            clusters_created += 1
        except Exception as e:
            db.rollback()
            logger.error(f"Failed to write cluster to DB: {str(e)}")
            continue
            
    db.commit()
    logger.info(f"Clustering complete. Created {clusters_created} clusters.")
    return clusters_created
