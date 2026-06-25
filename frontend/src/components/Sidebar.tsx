import React from "react";
import { Article, Cluster } from "./Timeline";

interface SidebarProps {
  article: Article | null;
  cluster: Cluster | null;
  onClose: () => void;
  onSelectArticle: (article: Article, cluster: Cluster) => void;
}

const formatDateFull = (dateStr: string) => {
  try {
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return dateStr;
    return d.toLocaleString(undefined, {
      weekday: "short",
      month: "short",
      day: "numeric",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit"
    });
  } catch (e) {
    return dateStr;
  }
};

export const Sidebar: React.FC<SidebarProps> = ({
  article,
  cluster,
  onClose,
  onSelectArticle,
}) => {
  if (!article || !cluster) {
    return (
      <aside className="details-sidebar" aria-label="Article Details Sidebar">
        <div 
          style={{ 
            height: "100%", 
            display: "flex", 
            flexDirection: "column", 
            alignItems: "center", 
            justifyContent: "center", 
            color: "var(--text-muted)",
            padding: "2rem",
            textAlign: "center"
          }}
        >
          <div style={{ fontSize: "2rem", marginBottom: "1rem" }}>📖</div>
          <h3>No article selected</h3>
          <p style={{ fontSize: "0.85rem", marginTop: "0.5rem" }}>
            Click on any event node on the timeline to read the full scraped content and view story evolution details.
          </p>
        </div>
      </aside>
    );
  }

  // Find similarity score for the current article
  const currentAssoc = cluster.article_associations.find(
    (assoc) => assoc.article.id === article.id
  );
  const similarityScore = currentAssoc ? currentAssoc.similarity_score : 1.0;

  // Get other articles in the cluster, sorted chronologically
  const otherArticles = [...cluster.article_associations]
    .filter((assoc) => assoc.article.id !== article.id)
    .sort(
      (a, b) => new Date(a.article.published_at).getTime() - new Date(b.article.published_at).getTime()
    );

  return (
    <aside className="details-sidebar" aria-label={`Details for article: ${article.title}`}>
      {/* HEADER SECTION */}
      <div className="sidebar-header">
        <div style={{ display: "flex", flexDirection: "column", gap: "0.25rem" }}>
          <span style={{ fontSize: "0.75rem", fontWeight: 700, textTransform: "uppercase", color: "var(--color-indigo)" }}>
            Story Evolution
          </span>
          <span className="sidebar-title" style={{ fontSize: "1rem", color: "var(--text-primary)" }}>
            Cluster Details
          </span>
        </div>
        <button 
          onClick={onClose}
          className="nav-btn" 
          aria-label="Close details panel"
          style={{ fontSize: "1.25rem" }}
        >
          ×
        </button>
      </div>

      {/* CONTENT BODY */}
      <div className="sidebar-content">
        {/* Title */}
        <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
          <h2 style={{ fontSize: "1.25rem", fontWeight: 700, lineHeight: 1.3, color: "#fff" }}>
            {article.title}
          </h2>
          
          {/* Badges/Metadata bar */}
          <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap", alignItems: "center", margin: "0.25rem 0" }}>
            <span 
              style={{ 
                padding: "0.2rem 0.5rem", 
                background: "rgba(255, 255, 255, 0.06)", 
                border: "1px solid var(--border-subtle)", 
                borderRadius: "4px", 
                fontSize: "0.75rem", 
                fontWeight: 600,
                color: "#e4e4e7"
              }}
            >
              {article.source}
            </span>
            {similarityScore < 0.99 && (
              <span 
                style={{ 
                  padding: "0.2rem 0.5rem", 
                  background: "rgba(16, 185, 129, 0.1)", 
                  border: "1px solid rgba(16, 185, 129, 0.2)", 
                  borderRadius: "4px", 
                  fontSize: "0.75rem", 
                  fontWeight: 600,
                  color: "var(--color-emerald)"
                }}
                title="Cosine similarity to cluster center article"
              >
                Sim: {Math.round(similarityScore * 100)}%
              </span>
            )}
          </div>

          <div style={{ fontSize: "0.8rem", color: "var(--text-muted)" }}>
            {article.author && <span>By {article.author} • </span>}
            <span>{formatDateFull(article.published_at)}</span>
          </div>
        </div>

        {/* Action Button */}
        <a 
          href={article.url} 
          target="_blank" 
          rel="noopener noreferrer" 
          style={{ textDecoration: "none" }}
        >
          <button className="btn btn-secondary" style={{ width: "100%", fontSize: "0.85rem" }}>
            🔗 Open Original Article
          </button>
        </a>

        <hr style={{ border: "none", borderTop: "1px solid var(--border-subtle)" }} />

        {/* Scraped Article Text */}
        <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
          <h3 style={{ fontSize: "0.9rem", fontWeight: 600, color: "var(--text-primary)" }}>Full Text</h3>
          <div 
            style={{ 
              fontSize: "0.9rem", 
              lineHeight: "1.6", 
              color: "var(--text-secondary)",
              maxHeight: "320px",
              overflowY: "auto",
              paddingRight: "0.5rem",
              whiteSpace: "pre-wrap"
            }}
          >
            {article.content || article.summary || "No content scraped for this article."}
          </div>
        </div>

        <hr style={{ border: "none", borderTop: "1px solid var(--border-subtle)" }} />

        {/* Other articles in cluster */}
        <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
          <h3 style={{ fontSize: "0.9rem", fontWeight: 600, color: "var(--text-primary)" }}>
            Cluster Timeline ({otherArticles.length + 1} total)
          </h3>
          {otherArticles.length === 0 ? (
            <p style={{ fontSize: "0.8rem", color: "var(--text-muted)" }}>
              No other articles in this cluster. This is an isolated story.
            </p>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: "0.6rem" }}>
              {otherArticles.map((assoc) => (
                <div 
                  key={assoc.article.id}
                  onClick={() => onSelectArticle(assoc.article, cluster)}
                  style={{
                    padding: "0.75rem",
                    background: "rgba(255, 255, 255, 0.02)",
                    border: "1px solid var(--border-subtle)",
                    borderRadius: "8px",
                    cursor: "pointer",
                    transition: "all 0.2s"
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.borderColor = "rgba(99, 102, 241, 0.3)";
                    e.currentTarget.style.background = "rgba(255, 255, 255, 0.04)";
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.borderColor = "var(--border-subtle)";
                    e.currentTarget.style.background = "rgba(255, 255, 255, 0.02)";
                  }}
                >
                  <div 
                    style={{ 
                      fontSize: "0.8rem", 
                      fontWeight: 600, 
                      color: "var(--text-primary)",
                      marginBottom: "0.25rem",
                      whiteSpace: "nowrap",
                      overflow: "hidden",
                      textOverflow: "ellipsis"
                    }}
                  >
                    {assoc.article.title}
                  </div>
                  <div style={{ display: "flex", justifyContent: "space-between", fontSize: "0.75rem", color: "var(--text-muted)" }}>
                    <span>{assoc.article.source}</span>
                    <span>{formatDateFull(assoc.article.published_at).split(",")[1]}</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </aside>
  );
};
