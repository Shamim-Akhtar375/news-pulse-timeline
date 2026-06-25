import React from "react";

interface Job {
  id: number;
  status: string;
  articles_fetched: number;
  articles_clustered: number;
  error_log: string | null;
  started_at: string;
  completed_at: string | null;
}

interface PipelineStatusProps {
  jobs: Job[];
  isTriggering: boolean;
  onTriggerPipeline: () => void;
  onClose: () => void;
}

const formatDateTime = (dateStr: string) => {
  try {
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return dateStr;
    return d.toLocaleString(undefined, {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit"
    });
  } catch {
    return dateStr;
  }
};

export const PipelineStatus: React.FC<PipelineStatusProps> = ({
  jobs,
  isTriggering,
  onTriggerPipeline,
  onClose,
}) => {
  const isAnyJobRunning = jobs.some((job) => job.status === "running");

  return (
    <div className="pipeline-overlay" onClick={onClose}>
      <div 
        className="pipeline-card glass-panel" 
        onClick={(e) => e.stopPropagation()}
        style={{
          border: "1px solid rgba(255, 255, 255, 0.12)",
          boxShadow: "0 20px 50px rgba(0, 0, 0, 0.6)"
        }}
      >
        {/* HEADER */}
        <div 
          className="sidebar-header" 
          style={{ 
            background: "rgba(15, 15, 20, 0.4)",
            borderBottom: "1px solid var(--border-subtle)",
            padding: "1.5rem 2rem" 
          }}
        >
          <div style={{ display: "flex", flexDirection: "column", gap: "0.25rem" }}>
            <h2 style={{ fontSize: "1.2rem", fontWeight: 700, color: "#fff" }}>
              Pipeline Monitor
            </h2>
            <p style={{ fontSize: "0.8rem", color: "var(--text-secondary)" }}>
              Track RSS feed ingestion jobs, scraper status, and ML clustering history.
            </p>
          </div>
          <button 
            onClick={onClose} 
            className="nav-btn" 
            aria-label="Close monitor"
            style={{ fontSize: "1.5rem" }}
          >
            ×
          </button>
        </div>

        {/* CONTENT */}
        <div className="pipeline-card-content">
          {/* Action Trigger Card */}
          <div 
            style={{
              padding: "1.5rem",
              background: "rgba(99, 102, 241, 0.04)",
              border: "1px solid rgba(99, 102, 241, 0.2)",
              borderRadius: "10px",
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              marginBottom: "2rem"
            }}
          >
            <div style={{ display: "flex", flexDirection: "column", gap: "0.35rem" }}>
              <h3 style={{ fontSize: "0.95rem", fontWeight: 600, color: "#fff" }}>
                Run Ingestion & Clustering
              </h3>
              <p style={{ fontSize: "0.8rem", color: "var(--text-secondary)", maxWidth: "420px" }}>
                Manually trigger the pipeline to parse default RSS feeds, scrape full texts, and run TF-IDF clustering.
              </p>
            </div>
            <button 
              className="btn btn-primary"
              onClick={onTriggerPipeline}
              disabled={isTriggering || isAnyJobRunning}
              style={{
                opacity: (isTriggering || isAnyJobRunning) ? 0.6 : 1,
                cursor: (isTriggering || isAnyJobRunning) ? "not-allowed" : "pointer"
              }}
            >
              {isAnyJobRunning ? (
                <>
                  <span className="spinner" style={{ marginRight: "0.5rem" }}>⏳</span> 
                  Running...
                </>
              ) : isTriggering ? (
                "Triggering..."
              ) : (
                "Run Pipeline Now"
              )}
            </button>
          </div>

          {/* HISTORICAL LOGS */}
          <h3 style={{ fontSize: "1rem", fontWeight: 600, color: "#fff", marginBottom: "1rem" }}>
            Execution Logs
          </h3>

          {jobs.length === 0 ? (
            <div style={{ padding: "3rem", textAlign: "center", color: "var(--text-muted)" }}>
              <div style={{ fontSize: "2rem", marginBottom: "0.75rem" }}>📋</div>
              <p>No pipeline runs logged yet.</p>
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
              {jobs.map((job) => {
                const isSuccess = job.status === "completed";
                const isRunning = job.status === "running";
                
                return (
                  <div 
                    key={job.id}
                    style={{
                      border: "1px solid var(--border-subtle)",
                      borderRadius: "8px",
                      background: "rgba(255, 255, 255, 0.01)",
                      overflow: "hidden"
                    }}
                  >
                    {/* Log Row Header */}
                    <div 
                      style={{
                        padding: "1rem 1.25rem",
                        display: "flex",
                        justifyContent: "space-between",
                        alignItems: "center",
                        background: "rgba(255, 255, 255, 0.01)"
                      }}
                    >
                      <div style={{ display: "flex", alignItems: "center", gap: "0.75rem" }}>
                        {/* Status Dot */}
                        <span 
                          style={{
                            width: "8px",
                            height: "8px",
                            borderRadius: "50%",
                            background: isRunning 
                              ? "var(--color-amber)" 
                              : isSuccess 
                                ? "var(--color-emerald)" 
                                : "var(--color-rose)",
                            boxShadow: isRunning
                              ? "0 0 8px var(--color-amber)"
                              : isSuccess
                                ? "0 0 8px var(--color-emerald)"
                                : "0 0 8px var(--color-rose)"
                          }}
                        />
                        <span style={{ fontSize: "0.85rem", fontWeight: 600, color: "#e4e4e7" }}>
                          Job #{job.id}
                        </span>
                        <span 
                          style={{
                            fontSize: "0.75rem",
                            padding: "0.15rem 0.4rem",
                            background: isRunning 
                              ? "rgba(245, 158, 11, 0.1)" 
                              : isSuccess 
                                ? "rgba(16, 185, 129, 0.1)" 
                                : "rgba(244, 63, 94, 0.1)",
                            color: isRunning 
                              ? "var(--color-amber)" 
                              : isSuccess 
                                ? "var(--color-emerald)" 
                                : "var(--color-rose)",
                            borderRadius: "4px",
                            fontWeight: 600,
                            textTransform: "uppercase"
                          }}
                        >
                          {job.status}
                        </span>
                      </div>
                      <span style={{ fontSize: "0.8rem", color: "var(--text-muted)" }}>
                        {formatDateTime(job.started_at)}
                      </span>
                    </div>

                    {/* Log Row Body */}
                    <div 
                      style={{
                        padding: "1rem 1.25rem",
                        borderTop: "1px solid var(--border-subtle)",
                        background: "rgba(0, 0, 0, 0.15)",
                        display: "flex",
                        flexDirection: "column",
                        gap: "0.5rem"
                      }}
                    >
                      <div style={{ display: "flex", gap: "2rem", fontSize: "0.85rem" }}>
                        <div>
                          <span style={{ color: "var(--text-muted)" }}>Articles Scraped: </span>
                          <strong style={{ color: "#fff" }}>{job.articles_fetched}</strong>
                        </div>
                        <div>
                          <span style={{ color: "var(--text-muted)" }}>Articles Clustered: </span>
                          <strong style={{ color: "#fff" }}>{job.articles_clustered}</strong>
                        </div>
                        {job.completed_at && (
                          <div style={{ marginLeft: "auto" }}>
                            <span style={{ color: "var(--text-muted)" }}>Completed: </span>
                            <span style={{ color: "var(--text-secondary)" }}>
                              {formatDateTime(job.completed_at).split(",")[1]}
                            </span>
                          </div>
                        )}
                      </div>

                      {/* Error Log display if job failed */}
                      {job.error_log && (
                        <div 
                          style={{
                            marginTop: "0.5rem",
                            padding: "0.75rem",
                            background: "rgba(244, 63, 94, 0.03)",
                            border: "1px solid rgba(244, 63, 94, 0.15)",
                            borderRadius: "6px",
                            fontFamily: "monospace",
                            fontSize: "0.75rem",
                            color: "#fda4af",
                            maxHeight: "120px",
                            overflowY: "auto",
                            whiteSpace: "pre-wrap"
                          }}
                        >
                          {job.error_log}
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
