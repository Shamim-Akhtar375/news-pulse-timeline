from pydantic import BaseModel, Field, field_validator, ConfigDict
from datetime import datetime
import json
from typing import Optional, Any

# Configure all schemas to use Pydantic V2 config format
class BaseSchema(BaseModel):
    model_config = ConfigDict(from_attributes=True)

# ----------------- ARTICLE SCHEMAS -----------------

class ArticleBase(BaseSchema):
    title: str = Field(..., max_length=512)
    content: str
    summary: Optional[str] = None
    url: str = Field(..., max_length=1024)
    source: str = Field(..., max_length=256)
    author: Optional[str] = Field(None, max_length=256)
    published_at: datetime

class ArticleCreate(ArticleBase):
    hash: str = Field(..., max_length=64)

class ArticleResponse(ArticleBase):
    id: int
    hash: str
    created_at: datetime
    updated_at: datetime

# ----------------- CLUSTER SCHEMAS -----------------

class ClusterBase(BaseSchema):
    title: str = Field(..., max_length=512)
    description: Optional[str] = None
    representative_keywords: Any = None
    is_active: bool = True

    @field_validator("representative_keywords", mode="before")
    @classmethod
    def parse_keywords(cls, v):
        if isinstance(v, str):
            try:
                return json.loads(v)
            except json.JSONDecodeError:
                return [k.strip() for k in v.split(",") if k.strip()]
        return v or []

class ClusterCreate(ClusterBase):
    pass

# Response object for many-to-many relationship
class ClusterArticleAssociation(BaseSchema):
    similarity_score: float
    article: ArticleResponse

class ClusterResponse(ClusterBase):
    id: int
    created_at: datetime
    updated_at: datetime
    article_associations: list[ClusterArticleAssociation] = []

class ClusterSummaryResponse(ClusterBase):
    id: int
    created_at: datetime
    updated_at: datetime
    article_count: int = 0

# ----------------- PIPELINE JOB SCHEMAS -----------------

class JobBase(BaseSchema):
    status: str = Field(..., max_length=50)
    articles_fetched: int = 0
    articles_clustered: int = 0
    error_log: Optional[str] = None

class JobResponse(JobBase):
    id: int
    started_at: datetime
    completed_at: Optional[datetime] = None

# ----------------- PAGINATION SCHEMAS -----------------

class PaginatedClustersResponse(BaseSchema):
    total: int
    page: int
    page_size: int
    items: list[ClusterResponse]

class PaginatedArticlesResponse(BaseSchema):
    total: int
    page: int
    page_size: int
    items: list[ArticleResponse]
