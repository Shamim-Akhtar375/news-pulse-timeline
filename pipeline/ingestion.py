import feedparser
import requests
from bs4 import BeautifulSoup
import hashlib
from datetime import datetime
import time
import email.utils
import logging
from typing import Optional, Dict, Any, List

# Set up logging configuration
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("news_pulse.ingestion")

# Standard headers to prevent scraping blocks
HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
}

def clean_html(html_content: str) -> str:
    """Extracts clean text content from raw HTML by removing headers, footers, scripts, and styles."""
    if not html_content:
        return ""
        
    soup = BeautifulSoup(html_content, "html.parser")
    
    # Remove script and style elements
    for element in soup(["script", "style", "nav", "header", "footer", "aside"]):
        element.decompose()
        
    # Search for common main article elements
    main_content = None
    for selector in ["article", ".article-content", ".post-content", ".entry-content", "main"]:
        found = soup.select_one(selector)
        if found:
            main_content = found
            break
            
    # Fallback to body if no specific article wrapper is found
    if not main_content:
        main_content = soup.body or soup
        
    # Extract text from paragraph tags inside the content block
    paragraphs = main_content.find_all("p")
    if paragraphs:
        text = "\n\n".join([p.get_text().strip() for p in paragraphs if p.get_text().strip()])
    else:
        text = main_content.get_text(separator="\n").strip()
        
    # Clean up excess whitespace
    lines = (line.strip() for line in text.splitlines())
    chunks = (phrase.strip() for line in lines for phrase in line.split("  "))
    cleaned_text = "\n\n".join(chunk for chunk in chunks if chunk)
    
    return cleaned_text

def fetch_full_text(url: str) -> str:
    """Downloads the HTML from a URL and extracts clean article text.
    Handles network errors and HTTP status checks, returning a fallback string if it fails.
    """
    logger.info(f"Scraping full text from: {url}")
    try:
        response = requests.get(url, headers=HEADERS, timeout=15)
        response.raise_for_status()
        
        # Extract and return clean text
        content = clean_html(response.text)
        if not content or len(content) < 100:
            logger.warning(f"Extracted content from {url} is extremely short or empty.")
            return ""
        return content
    except Exception as e:
        logger.error(f"Failed to fetch full text from {url}: {str(e)}")
        # Raise exception to let the caller handle it or store an empty text
        raise e

def parse_published_date(entry: Any) -> datetime:
    """Parses publication date from an RSS feed entry, standardizing on UTC datetime."""
    # Try different standard RSS fields
    date_fields = ["published_parsed", "updated_parsed", "created_parsed"]
    
    for field in date_fields:
        date_struct = getattr(entry, field, None)
        if date_struct:
            return datetime.fromtimestamp(time.mktime(date_struct))
            
    # Try parsing text date fields directly
    date_text_fields = ["published", "pubDate", "updated", "created"]
    for field in date_text_fields:
        date_str = getattr(entry, field, None)
        if date_str:
            try:
                # Use email utility to parse standard pubDate formats
                parsed_tuple = email.utils.parsedate_tz(date_str)
                if parsed_tuple:
                    timestamp = email.utils.mktime_tz(parsed_tuple)
                    return datetime.fromtimestamp(timestamp)
            except Exception:
                pass
                
    # Fallback to current time if no date can be parsed
    return datetime.utcnow()

def compute_hash(title: str, url: str) -> str:
    """Computes a unique, deterministic SHA-256 hash for deduplication based on article metadata."""
    payload = f"{title.strip().lower()}|{url.strip().lower()}"
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()

def normalize_feed_entry(entry: Any, source_name: str) -> Optional[Dict[str, Any]]:
    """Transforms a raw feedparser entry into a standardized Article dictionary."""
    try:
        title = entry.title if hasattr(entry, "title") else ""
        link = entry.link if hasattr(entry, "link") else ""
        
        if not title or not link:
            logger.warning(f"Skipping entry: missing title or link. Raw: {entry}")
            return None
            
        summary = entry.summary if hasattr(entry, "summary") else ""
        # Clean HTML from summary
        summary = BeautifulSoup(summary, "html.parser").get_text().strip() if summary else ""
        
        author = entry.author if hasattr(entry, "author") else None
        published_at = parse_published_date(entry)
        article_hash = compute_hash(title, link)
        
        return {
            "title": title.strip(),
            "summary": summary,
            "url": link.strip(),
            "source": source_name,
            "author": author.strip() if author else None,
            "published_at": published_at,
            "hash": article_hash
        }
    except Exception as e:
        logger.error(f"Error normalizing feed entry: {str(e)}")
        return None

def fetch_feed_articles(feed_url: str) -> List[Dict[str, Any]]:
    """Fetches and parses a single RSS feed, returning a list of normalized articles."""
    logger.info(f"Fetching RSS feed from: {feed_url}")
    try:
        feed = feedparser.parse(feed_url)
        
        # Extract feed title / source name
        source_name = "Unknown Source"
        if hasattr(feed, "feed") and hasattr(feed.feed, "title"):
            source_name = feed.feed.title
        elif "techcrunch" in feed_url.lower():
            source_name = "TechCrunch"
        elif "nytimes" in feed_url.lower():
            source_name = "New York Times"
        elif "bbc" in feed_url.lower():
            source_name = "BBC News"
            
        articles = []
        for entry in feed.entries:
            normalized = normalize_feed_entry(entry, source_name)
            if normalized:
                articles.append(normalized)
                
        logger.info(f"Parsed {len(articles)} articles from {source_name}")
        return articles
    except Exception as e:
        logger.error(f"Failed to parse feed {feed_url}: {str(e)}")
        return []
