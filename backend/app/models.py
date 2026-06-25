from sqlalchemy import Column, Integer, String, Text, Float, Boolean, DateTime, ForeignKey, Index, func
from sqlalchemy.orm import relationship
from backend.app.database import Base

class Article(Base):
    __tablename__ = "articles"

    id = Column(Integer, primary_key=True, index=True)
    title = Column(String(512), nullable=False)
    content = Column(Text, nullable=False)  # Full scraped text
    summary = Column(Text, nullable=True)   # Snippet / description from RSS
    url = Column(String(1024), unique=True, nullable=False, index=True)
    source = Column(String(256), nullable=False, index=True)
    author = Column(String(256), nullable=True)
    published_at = Column(DateTime, nullable=False, index=True)
    hash = Column(String(64), unique=True, nullable=False, index=True)  # SHA-256 hash of article content/title
    created_at = Column(DateTime, server_default=func.now())
    updated_at = Column(DateTime, server_default=func.now(), onupdate=func.now())

    # Relationships
    cluster_association = relationship("ClusterArticle", back_populates="article", cascade="all, delete-orphan")

class Cluster(Base):
    __tablename__ = "clusters"

    id = Column(Integer, primary_key=True, index=True)
    title = Column(String(512), nullable=False)
    description = Column(Text, nullable=True)
    representative_keywords = Column(Text, nullable=True)  # JSON-encoded array of keywords
    is_active = Column(Boolean, default=True, index=True)
    created_at = Column(DateTime, server_default=func.now(), index=True)
    updated_at = Column(DateTime, server_default=func.now(), onupdate=func.now())

    # Relationships
    article_associations = relationship(
        "ClusterArticle", 
        back_populates="cluster", 
        cascade="all, delete-orphan",
        order_by="desc(ClusterArticle.created_at)"
    )

class ClusterArticle(Base):
    __tablename__ = "cluster_articles"

    cluster_id = Column(Integer, ForeignKey("clusters.id", ondelete="CASCADE"), primary_key=True)
    article_id = Column(Integer, ForeignKey("articles.id", ondelete="CASCADE"), primary_key=True)
    similarity_score = Column(Float, nullable=False)
    created_at = Column(DateTime, server_default=func.now())

    # Relationships
    cluster = relationship("Cluster", back_populates="article_associations")
    article = relationship("Article", back_populates="cluster_association")

    # Index for fast joins and lookups
    __table_args__ = (
        Index("idx_cluster_article_lookup", "cluster_id", "article_id"),
    )

class Job(Base):
    __tablename__ = "jobs"

    id = Column(Integer, primary_key=True, index=True)
    status = Column(String(50), nullable=False, default="running", index=True)  # running, completed, failed
    articles_fetched = Column(Integer, nullable=False, default=0)
    articles_clustered = Column(Integer, nullable=False, default=0)
    error_log = Column(Text, nullable=True)
    started_at = Column(DateTime, server_default=func.now())
    completed_at = Column(DateTime, nullable=True)
