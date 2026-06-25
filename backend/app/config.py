import os
from dotenv import load_dotenv

# Load environment variables from .env file
load_dotenv()

class Settings:
    # Project Info
    PROJECT_NAME: str = "News Pulse API"
    VERSION: str = "1.0.0"
    
    # Server configuration
    HOST: str = os.getenv("HOST", "0.0.0.0")
    PORT: int = int(os.getenv("PORT", "8000"))
    
    # Database Configuration
    # Default to sqlite locally for ease of setup. Can be overridden with PostgreSQL URL.
    DATABASE_URL: str = os.getenv("DATABASE_URL", "sqlite:///./news_pulse.db")
    
    # ML/Clustering settings
    # Similarity threshold (cosine similarity using TF-IDF)
    # Range 0.0 to 1.0. Higher means articles must be more similar to group together.
    SIMILARITY_THRESHOLD: float = float(os.getenv("SIMILARITY_THRESHOLD", "0.40"))
    
    # RSS Feeds to monitor (comma-separated URLs)
    DEFAULT_FEEDS = [
        "https://techcrunch.com/feed/",
        "https://rss.nytimes.com/services/xml/rss/nyt/World.xml",
        "https://rss.nytimes.com/services/xml/rss/nyt/Technology.xml",
        "https://feeds.bbci.co.uk/news/rss.xml",
        "https://feeds.bbci.co.uk/news/technology/rss.xml",
        "https://dev.to/feed"
    ]
    
    @property
    def RSS_FEEDS(self) -> list[str]:
        feeds_str = os.getenv("RSS_FEEDS", "")
        if feeds_str:
            return [url.strip() for url in feeds_str.split(",") if url.strip()]
        return self.DEFAULT_FEEDS

settings = Settings()
