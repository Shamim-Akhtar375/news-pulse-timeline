import React, { useState, useRef, useMemo } from "react";

export interface Article {
  id: number;
  title: string;
  summary: string;
  url: string;
  source: string;
  author: string | null;
  published_at: string;
  hash: string;
  content?: string;
  similarity_score?: number;
}

export interface ArticleAssociation {
  similarity_score: number;
  article: Article;
}

export interface Cluster {
  id: number;
  title: string;
  description: string | null;
  representative_keywords: string[];
  is_active: boolean;
  created_at: string;
  updated_at: string;
  article_associations: ArticleAssociation[];
  // timeline specific fields
  label?: string;
  start_time?: string;
  end_time?: string;
  article_count?: number;
}

export interface TimelineProps {
  clusters: Cluster[];
  selectedArticleId: number | null;
  onSelectArticle: (article: Article, cluster: Cluster) => void;
  isLoading: boolean;
}

// Helper to format dates safely without date-fns package dependency
const formatDate = (dateStr: string, formatStr: "short" | "full" = "short") => {
  try {
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return dateStr;
    if (formatStr === "short") {
      return d.toLocaleDateString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
    }
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

export const Timeline: React.FC<TimelineProps> = ({
  clusters,
  selectedArticleId,
  onSelectArticle,
  isLoading,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const [zoom, setZoom] = useState<number>(1.0);
  const [panOffset, setPanOffset] = useState<{ x: number; y: number }>({ x: 50, y: 0 });
  const [isDragging, setIsDragging] = useState<boolean>(false);
  const [dragStart, setDragStart] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const [tooltip, setTooltip] = useState<{
    article: Article;
    x: number;
    y: number;
    visible: boolean;
  } | null>(null);

  // Default dimensions
  const trackHeight = 110;
  const trackLabelWidth = 280;
  const timelineMinWidth = 1200;

  // Flatten and sort all articles to find time bounds
  const timeBounds = useMemo(() => {
    const times: number[] = [];
    clusters.forEach((c) => {
      c.article_associations.forEach((assoc) => {
        const time = new Date(assoc.article.published_at).getTime();
        if (!isNaN(time)) {
          times.push(time);
        }
      });
    });

    if (times.length === 0) {
      return { min: Date.now() - 86400000 * 3, max: Date.now(), diff: 86400000 * 3 }; // 3 days fallback
    }

    const min = Math.min(...times);
    const max = Math.max(...times);
    // Add 5% padding to bounds
    const diff = max - min || 86400000; // default 1 day
    return {
      min: min - diff * 0.05,
      max: max + diff * 0.05,
      diff: diff * 1.1,
    };
  }, [clusters]);

  // Compute position helper
  const getCoordinates = (publishedAt: string, clusterIdx: number) => {
    const time = new Date(publishedAt).getTime();
    const ratio = (time - timeBounds.min) / timeBounds.diff;
    const x = ratio * timelineMinWidth;
    const y = clusterIdx * trackHeight + trackHeight / 2;
    return { x, y };
  };

  // Zoom / Pan handlers
  const handleMouseDown = (e: React.MouseEvent) => {
    // Only drag with left click
    if (e.button !== 0) return;
    setIsDragging(true);
    setDragStart({ x: e.clientX - panOffset.x, y: e.clientY - panOffset.y });
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    if (!isDragging) return;
    setPanOffset({
      x: e.clientX - dragStart.x,
      y: e.clientY - dragStart.y,
    });
  };

  const handleMouseUp = () => {
    setIsDragging(false);
  };

  const handleWheel = (e: React.WheelEvent) => {
    e.preventDefault();
    const zoomFactor = 1.1;
    let newZoom = zoom;
    if (e.deltaY < 0) {
      newZoom = Math.min(zoom * zoomFactor, 3.0);
    } else {
      newZoom = Math.max(zoom / zoomFactor, 0.4);
    }
    setZoom(newZoom);
  };

  const resetView = () => {
    setZoom(1.0);
    setPanOffset({ x: 50, y: 0 });
  };

  // Hover Tooltip Handlers
  const showTooltip = (article: Article, e: React.MouseEvent) => {
    if (!containerRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    
    // Position tooltip relative to container
    const relativeX = e.clientX - rect.left;
    const relativeY = e.clientY - rect.top;
    
    setTooltip({
      article,
      x: relativeX,
      y: relativeY,
      visible: true
    });
  };

  const hideTooltip = () => {
    setTooltip(null);
  };

  // Render Skeletons during Loading state
  if (isLoading) {
    return (
      <div className="timeline-container glass-panel" style={{ height: "100%", margin: "1.5rem" }}>
        <div className="empty-state" style={{ width: "100%" }}>
          <div className="skeleton-pulse skeleton-title" style={{ width: "40%" }}></div>
          <div className="skeleton-pulse skeleton-text" style={{ width: "80%" }}></div>
          <div className="skeleton-pulse skeleton-text" style={{ width: "70%" }}></div>
          <div className="skeleton-pulse skeleton-text" style={{ width: "60%" }}></div>
        </div>
      </div>
    );
  }

  // Handle Empty State
  if (!clusters || clusters.length === 0) {
    return (
      <div className="timeline-container glass-panel" style={{ margin: "1.5rem" }}>
        <div className="empty-state">
          <div className="empty-state-icon">📡</div>
          <h2>No story clusters found</h2>
          <p>The system hasn't ingested any articles yet, or your search filter didn't yield matches.</p>
          <p className="text-muted">Click "Run Ingestion Pipeline" in the top bar to pull articles.</p>
        </div>
      </div>
    );
  }

  const svgHeight = Math.max(clusters.length * trackHeight, 400);

  return (
    <div 
      className="timeline-workspace"
      style={{ display: "flex", flexDirection: "row", flex: 1, overflow: "hidden" }}
    >
      {/* LEFT COLUMN: Sticky Cluster Labels */}
      <div 
        className="track-labels"
        style={{
          width: trackLabelWidth,
          borderRight: "1px solid var(--border-subtle)",
          background: "rgba(10, 10, 12, 0.9)",
          zIndex: 6,
          display: "flex",
          flexDirection: "column",
          transform: `translateY(${panOffset.y}px)`, // vertical panning aligns with canvas
          transition: isDragging ? "none" : "transform 0.1s ease-out"
        }}
      >
        {clusters.map((cluster, idx) => (
          <div 
            key={cluster.id}
            style={{
              height: trackHeight,
              padding: "1rem",
              borderBottom: "1px solid var(--border-subtle)",
              display: "flex",
              flexDirection: "column",
              justifyContent: "center",
              gap: "0.4rem",
              overflow: "hidden"
            }}
          >
            <div 
              style={{
                fontSize: "0.85rem",
                fontWeight: 600,
                color: varColorForCluster(idx),
                whiteSpace: "nowrap",
                overflow: "hidden",
                textOverflow: "ellipsis"
              }}
              title={cluster.title}
            >
              {cluster.title}
            </div>
            <div style={{ display: "flex", gap: "0.25rem", flexWrap: "wrap" }}>
              {cluster.representative_keywords.slice(0, 3).map((kw, kIdx) => (
                <span key={kIdx} className="keyword-badge" style={{ fontSize: "0.65rem", padding: "0.1rem 0.4rem" }}>
                  {kw}
                </span>
              ))}
              <span style={{ fontSize: "0.7rem", color: "var(--text-muted)", marginLeft: "auto", alignSelf: "center" }}>
                {cluster.article_associations.length} {cluster.article_associations.length === 1 ? "art" : "arts"}
              </span>
            </div>
          </div>
        ))}
      </div>

      {/* RIGHT COLUMN: Interactive Zoom/Pan Timeline Canvas */}
      <div 
        ref={containerRef}
        className="timeline-container"
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
        onWheel={handleWheel}
        style={{
          flex: 1,
          height: "100%",
          position: "relative",
          overflow: "hidden",
          background: "var(--bg-dark)"
        }}
      >
        {/* SVG/HTML Canvas Transform Box */}
        <div 
          className="timeline-canvas"
          style={{
            transform: `translate(${panOffset.x}px, ${panOffset.y}px) scale(${zoom})`,
            width: timelineMinWidth,
            height: svgHeight,
            transition: isDragging ? "none" : "transform 0.15s cubic-bezier(0.16, 1, 0.3, 1)",
            position: "absolute",
            top: 0,
            left: 0
          }}
        >
          <svg 
            width={timelineMinWidth} 
            height={svgHeight} 
            style={{ overflow: "visible", position: "absolute", inset: 0 }}
          >
            <defs>
              <linearGradient id="line-gradient" x1="0%" y1="0%" x2="100%" y2="0%">
                <stop offset="0%" stopColor="var(--color-indigo)" stopOpacity="0.4" />
                <stop offset="100%" stopColor="var(--color-violet)" stopOpacity="0.8" />
              </linearGradient>
            </defs>

            {/* Vertical grid lines (Time markers) */}
            {[0.1, 0.3, 0.5, 0.7, 0.9].map((ratio, gridIdx) => {
              const xPos = ratio * timelineMinWidth;
              const timestamp = timeBounds.min + ratio * timeBounds.diff;
              return (
                <g key={gridIdx}>
                  <line 
                    x1={xPos} 
                    y1={0} 
                    x2={xPos} 
                    y2={svgHeight} 
                    className="timeline-grid-lines" 
                  />
                  <text 
                    x={xPos} 
                    y={15} 
                    fill="var(--text-muted)" 
                    fontSize="9px" 
                    textAnchor="middle"
                  >
                    {formatDate(new Date(timestamp).toISOString())}
                  </text>
                </g>
              );
            })}

            {/* Render tracks and connections */}
            {clusters.map((cluster, cIdx) => {
              const yPos = cIdx * trackHeight + trackHeight / 2;
              
              // Sort articles in cluster chronologically
              const sortedAssocs = [...cluster.article_associations].sort(
                (a, b) => new Date(a.article.published_at).getTime() - new Date(b.article.published_at).getTime()
              );

              // 1. Draw horizontal track line helper
              return (
                <g key={`track-g-${cluster.id}`}>
                  <line 
                    x1={0} 
                    y1={yPos} 
                    x2={timelineMinWidth} 
                    y2={yPos} 
                    className="timeline-track-line" 
                  />
                  
                  {/* 2. Draw connector curve if multiple articles */}
                  {sortedAssocs.length > 1 && (
                    <path
                      d={generateCurvePath(sortedAssocs, cIdx)}
                      className="timeline-connection-line"
                    />
                  )}

                  {/* 3. Render Nodes */}
                  {sortedAssocs.map((assoc) => {
                    const { article } = assoc;
                    const coords = getCoordinates(article.published_at, cIdx);
                    const isActive = article.id === selectedArticleId;
                    
                    return (
                      <g 
                        key={`node-${article.id}`} 
                        className={`timeline-node ${isActive ? "active" : ""}`}
                        onClick={(e) => {
                          e.stopPropagation();
                          onSelectArticle(article, cluster);
                        }}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" || e.key === " ") {
                            e.preventDefault();
                            onSelectArticle(article, cluster);
                          }
                        }}
                        tabIndex={0}
                        aria-label={`Article: ${article.title}. Source: ${article.source}`}
                        onMouseEnter={(e) => showTooltip(article, e)}
                        onMouseMove={(e) => showTooltip(article, e)}
                        onMouseLeave={hideTooltip}
                      >
                        {/* Interactive outer glowing field on focus/active */}
                        <circle 
                          cx={coords.x} 
                          cy={coords.y} 
                          r={isActive ? 11 : 7} 
                        />
                      </g>
                    );
                  })}
                </g>
              );
            })}
          </svg>
        </div>

        {/* Zoom & Pan Control Dashboard overlay */}
        <div className="timeline-navigation">
          <button className="nav-btn" onClick={() => setZoom(Math.max(zoom / 1.2, 0.4))} title="Zoom Out" aria-label="Zoom Out">-</button>
          <span className="zoom-level">{Math.round(zoom * 100)}%</span>
          <button className="nav-btn" onClick={() => setZoom(Math.min(zoom * 1.2, 3.0))} title="Zoom In" aria-label="Zoom In">+</button>
          <button className="nav-btn" onClick={resetView} title="Recenter View" aria-label="Recenter View">⌂</button>
        </div>

        {/* Hover Tooltip Overlay (rendered absolutely on viewport, absolute coords computed) */}
        {tooltip && tooltip.visible && (
          <div 
            className="timeline-tooltip"
            style={{ 
              left: tooltip.x, 
              top: tooltip.y, 
              opacity: 1, 
              transform: "translate(-50%, -100%) translateY(-12px)" 
            }}
          >
            <div className="tooltip-title">{tooltip.article.title}</div>
            <div className="tooltip-meta">
              <span>{tooltip.article.source}</span>
              <span>{formatDate(tooltip.article.published_at)}</span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

// Generates smooth SVG path between chronologically ordered nodes
const generateCurvePath = (assocs: ArticleAssociation[], clusterIdx: number) => {
  const trackHeight = 110;
  const timelineMinWidth = 1200;
  
  // Hardcoded values from timeline layout config
  const timeBounds = {
    times: assocs.map(a => new Date(a.article.published_at).getTime())
  };
  const min = Math.min(...timeBounds.times);
  const max = Math.max(...timeBounds.times);
  const diff = max - min || 86400000;
  const paddedMin = min - diff * 0.05;
  const paddedDiff = diff * 1.1;

  const points = assocs.map((assoc) => {
    const time = new Date(assoc.article.published_at).getTime();
    const ratio = (time - paddedMin) / paddedDiff;
    const x = ratio * timelineMinWidth;
    const y = clusterIdx * trackHeight + trackHeight / 2;
    return { x, y };
  });

  // SVG curved path builder
  let path = `M ${points[0].x} ${points[0].y}`;
  for (let i = 0; i < points.length - 1; i++) {
    const curr = points[i];
    const next = points[i + 1];
    
    // Standard Bezier control points to create nice wave curves
    const cp1x = curr.x + (next.x - curr.x) / 3;
    const cp1y = curr.y - 12; // curve slightly upwards
    const cp2x = curr.x + 2 * (next.x - curr.x) / 3;
    const cp2y = curr.y + 12; // curve slightly downwards
    
    path += ` C ${cp1x} ${cp1y}, ${cp2x} ${cp2y}, ${next.x} ${next.y}`;
  }
  return path;
};

// Returns a nice color for the cluster track based on its index
const varColorForCluster = (idx: number) => {
  const colors = [
    "var(--color-indigo)",
    "var(--color-violet)",
    "var(--color-emerald)",
    "var(--color-amber)",
    "var(--color-rose)"
  ];
  return colors[idx % colors.length];
};
