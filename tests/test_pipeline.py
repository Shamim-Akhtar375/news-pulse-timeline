import unittest
from datetime import datetime
from pipeline.ingestion import compute_hash, clean_html
from pipeline.clustering import perform_clustering
from backend.app.models import Article

class TestNewsPulsePipeline(unittest.TestCase):
    
    def test_deduplication_hashing(self):
        """Verify that hashing same title and URL is deterministic and yields the same signature."""
        title = "Breaking Tech News"
        url = "https://techcrunch.com/article1"
        
        hash1 = compute_hash(title, url)
        hash2 = compute_hash(title, url)
        hash3 = compute_hash("Different Title", url)
        
        self.assertEqual(hash1, hash2)
        self.assertNotEqual(hash1, hash3)
        self.assertEqual(len(hash1), 64) # SHA-256 length in hex

    def test_clean_html_extractor(self):
        """Verify that cleaning raw HTML extracts paragraph texts while ignoring scripts and nav wrappers."""
        raw_html = """
        <html>
            <head><title>Test Page</title></head>
            <body>
                <header><nav><a href="/">Home</a></nav></header>
                <article>
                    <h1>Super News</h1>
                    <p>First paragraph of the news.</p>
                    <p>Second paragraph details.</p>
                </article>
                <script>console.log("hello");</script>
                <footer>&copy; 2026</footer>
            </body>
        </html>
        """
        cleaned = clean_html(raw_html)
        self.assertIn("First paragraph of the news.", cleaned)
        self.assertIn("Second paragraph details.", cleaned)
        self.assertNotIn("Home", cleaned)
        self.assertNotIn("console.log", cleaned)

    def test_ml_clustering_deterministic(self):
        """Verify that the chronological clustering algorithm groups similar articles deterministically
        and splits dissimilar ones.
        """
        # Create mock articles
        # A1 and A2 are very similar (same event)
        # A3 is completely different
        a1 = Article(
            id=1,
            title="Apple announces new iPhone 18 with 5G technology",
            content="Apple unveiled its latest iPhone 18 smartphone today, featuring advanced 5G connectivity, high battery performance, and an updated neural engine processor.",
            summary="New iPhone 18 released.",
            url="https://apple.com/iphone-18",
            source="Apple News",
            published_at=datetime(2026, 6, 25, 10, 0, 0),
            hash="h1"
        )
        a2 = Article(
            id=2,
            title="iPhone 18 launched by Apple with superfast 5G",
            content="Today, tech giant Apple introduced the brand new iPhone 18. The smartphone comes loaded with high performance 5G, enhanced battery specs, and a faster processor.",
            summary="Apple unveils iPhone 18.",
            url="https://techblog.com/iphone-18-launch",
            source="Tech Blog",
            published_at=datetime(2026, 6, 25, 10, 5, 0),
            hash="h2"
        )
        a3 = Article(
            id=3,
            title="Federal Reserve leaves interest rates unchanged",
            content="The Federal Reserve Board of Governors decided to maintain interest rates at their current target range today, citing stable inflation rates and strong jobs growth numbers.",
            summary="Fed rate decision unchanged.",
            url="https://finance.com/fed-interest-rates",
            source="Finance Daily",
            published_at=datetime(2026, 6, 25, 11, 0, 0),
            hash="h3"
        )
        
        corpus = [a1, a2, a3]
        
        # Run clustering with default threshold
        clusters = perform_clustering(corpus, threshold=0.40)
        
        # We expect 2 clusters: Cluster 1 (a1 & a2), Cluster 2 (a3)
        self.assertEqual(len(clusters), 2)
        
        # Verify group structures
        iphone_cluster = next(c for c in clusters if "iPhone" in c["title"])
        fed_cluster = next(c for c in clusters if "Federal Reserve" in c["title"])
        
        # Check counts
        self.assertEqual(len(iphone_cluster["articles"]), 2)
        self.assertEqual(len(fed_cluster["articles"]), 1)
        
        # Check cluster keywords
        self.assertIn("iphone", iphone_cluster["keywords"])
        self.assertIn("apple", iphone_cluster["keywords"])
        self.assertIn("reserve", fed_cluster["keywords"])

if __name__ == "__main__":
    unittest.main()
