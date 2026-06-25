import { useState, useEffect, useCallback, useMemo } from "react";
import { Timeline, Article, Cluster } from "./components/Timeline";
import { Sidebar } from "./components/Sidebar";
import { PipelineStatus } from "./components/PipelineStatus";

interface Job {
  id: number;
  status: string;
  articles_fetched: number;
  articles_clustered: number;
  error_log: string | null;
  started_at: string;
  completed_at: string | null;
}

// Configurable API URL pointing to the Node.js backend
const API_BASE_URL = import.meta.env.VITE_API_URL || "http://localhost:8000";

function App() {
  const [allTimelineClusters, setAllTimelineClusters] = useState<Cluster[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Filters State
  const [searchQuery, setSearchQuery] = useState<string>("");
  const [debouncedSearch, setDebouncedSearch] = useState<string>("");
  const [startDate, setStartDate] = useState<string>("");
  const [endDate, setEndDate] = useState<string>("");
  const [selectedSources, setSelectedSources] = useState<string[]>([]);

  // Selection State
  const [selectedArticle, setSelectedArticle] = useState<Article | null>(null);
  const [selectedCluster, setSelectedCluster] = useState<Cluster | null>(null);

  // Pipeline/Job State
  const [showPipelineModal, setShowPipelineModal] = useState<boolean>(false);
  const [pipelineJobs, setPipelineJobs] = useState<Job[]>([]);
  const [activeJobId, setActiveJobId] = useState<number | null>(null);
  const [activeJobStatus, setActiveJobStatus] = useState<string | null>(null);
  const [isTriggering, setIsTriggering] = useState<boolean>(false);

  // 1. Debounce Search Input
  useEffect(() => {
    const handler = setTimeout(() => {
      setDebouncedSearch(searchQuery);
    }, 300);
    return () => clearTimeout(handler);
  }, [searchQuery]);

  // 2. Fetch Timeline Data (Main REST API)
  const fetchTimelineData = useCallback(async () => {
    setIsLoading(true);
    setErrorMsg(null);
    try {
      const res = await fetch(`${API_BASE_URL}/timeline`);
      if (!res.ok) {
        throw new Error(`Failed to load timeline: HTTP ${res.status}`);
      }
      const data = await res.json();
      
      // Standardize schema fields: Node.js /timeline returns article_associations,
      // mapping them properly for the Timeline component.
      const standardized = data.map((item: any) => ({
        ...item,
        title: item.label, // timeline label maps to title
        article_associations: item.article_associations || []
      }));
      
      setAllTimelineClusters(standardized);
    } catch (err: any) {
      console.error(err);
      setErrorMsg(err.message || "Could not connect to the Node.js API server.");
    } finally {
      setIsLoading(false);
    }
  }, []);

  // Fetch timeline on mount
  useEffect(() => {
    fetchTimelineData();
  }, [fetchTimelineData]);

  // 3. Extract unique news sources for the filter toggle UI
  const availableSources = useMemo(() => {
    const sources = new Set<string>();
    allTimelineClusters.forEach(cluster => {
      cluster.article_associations.forEach(assoc => {
        if (assoc.article.source) {
          sources.add(assoc.article.source);
        }
      });
    });
    return Array.from(sources).sort();
  }, [allTimelineClusters]);

  // Toggle source filter
  const handleToggleSource = (source: string) => {
    setSelectedSources(prev => 
      prev.includes(source) ? prev.filter(s => s !== source) : [...prev, source]
    );
  };

  // 4. Client-side filtration for instant updates
  const filteredClusters = useMemo(() => {
    return allTimelineClusters.filter(cluster => {
      // Search text filter
      if (debouncedSearch) {
        const query = debouncedSearch.toLowerCase();
        const matchesLabel = cluster.label.toLowerCase().includes(query);
        const matchesKeyword = cluster.representative_keywords.some(k => k.toLowerCase().includes(query));
        const matchesArticle = cluster.article_associations.some(assoc => 
          assoc.article.title.toLowerCase().includes(query) ||
          (assoc.article.summary && assoc.article.summary.toLowerCase().includes(query))
        );
        
        if (!matchesLabel && !matchesKeyword && !matchesArticle) {
          return false;
        }
      }

      // Source checkbox filter
      if (selectedSources.length > 0) {
        const hasMatchingSource = cluster.article_associations.some(assoc => 
          selectedSources.includes(assoc.article.source)
        );
        if (!hasMatchingSource) return false;
      }

      // Start Date Filter
      if (startDate) {
        const startTimestamp = new Date(startDate).getTime();
        const clusterEndTimestamp = new Date(cluster.end_time).getTime();
        if (clusterEndTimestamp < startTimestamp) return false;
      }

      // End Date Filter
      if (endDate) {
        const end = new Date(endDate);
        end.setHours(23, 59, 59, 999);
        const clusterStartTimestamp = new Date(cluster.start_time).getTime();
        if (clusterStartTimestamp > end.getTime()) return false;
      }

      return true;
    });
  }, [allTimelineClusters, debouncedSearch, selectedSources, startDate, endDate]);

  // 5. Select Cluster/Node Handler - Fetches full detail (with scraped text body)
  const handleSelectArticle = async (article: Article, cluster: Cluster) => {
    // Eagerly set selection in state
    setSelectedArticle(article);
    setSelectedCluster(cluster);

    try {
      // Query GET /clusters/:id to fetch full details including scraped contents
      const res = await fetch(`${API_BASE_URL}/clusters/${cluster.id}`);
      if (res.ok) {
        const fullCluster = await res.json();
        
        // Find matching article in the full cluster response
        const matchingArticle = fullCluster.articles.find((a: any) => a.id === article.id);
        
        // Standardize cluster data fields
        const standardizedCluster = {
          ...fullCluster,
          article_associations: fullCluster.articles.map((art: any) => ({
            similarity_score: art.similarity_score,
            article: art
          }))
        };
        
        setSelectedCluster(standardizedCluster);
        if (matchingArticle) {
          setSelectedArticle(matchingArticle);
        }
      }
    } catch (error) {
      console.error("Error loading cluster details:", error);
    }
  };

  const handleClearSelection = () => {
    setSelectedArticle(null);
    setSelectedCluster(null);
  };

  // 6. Trigger Pipeline & Async Polling
  const triggerPipeline = async () => {
    setIsTriggering(true);
    try {
      const res = await fetch(`${API_BASE_URL}/ingest/trigger`, {
        method: "POST"
      });
      if (!res.ok) {
        throw new Error("Trigger request failed");
      }
      const data = await res.json();
      const jobId = data.jobId;
      
      setActiveJobId(jobId);
      setActiveJobStatus("running");
      
      // Open modal automatically to show logging details
      setShowPipelineModal(true);
    } catch (err) {
      console.error(err);
      alert("Failed to start ingestion pipeline.");
    } finally {
      setIsTriggering(false);
    }
  };

  // Poll job status while active
  useEffect(() => {
    if (!activeJobId) return;

    let intervalId = setInterval(async () => {
      try {
        const res = await fetch(`${API_BASE_URL}/ingest/status/${activeJobId}`);
        if (res.ok) {
          const job = await res.json();
          
          // Update status logs
          setPipelineJobs(prev => {
            const index = prev.findIndex(j => j.id === job.id);
            if (index !== -1) {
              const updated = [...prev];
              updated[index] = job;
              return updated;
            }
            return [job, ...prev];
          });

          if (job.status !== "running") {
            // Job finished (completed or failed)
            setActiveJobId(null);
            setActiveJobStatus(null);
            clearInterval(intervalId);
            
            // Re-fetch timeline with fresh clusters!
            fetchTimelineData();
          }
        }
      } catch (err) {
        console.error("Error polling job status:", err);
      }
    }, 3000);

    return () => clearInterval(intervalId);
  }, [activeJobId, fetchTimelineData]);

  // Load general logs when modal opens
  const fetchLogsHistory = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE_URL}/ingest/jobs`);
      if (res.ok) {
        const data = await res.json();
        setPipelineJobs(data || []);
      }
    } catch (err) {
      console.error("Failed to fetch jobs history:", err);
    }
  }, []);

  // Fetch jobs history when modal is opened
  useEffect(() => {
    if (showPipelineModal) {
      fetchLogsHistory();
    }
  }, [showPipelineModal, fetchLogsHistory]);

  return (
    <div className="app-container">
      {/* HEADER SECTION */}
      <header className="app-header">
        <div className="logo-section">
          <div className="logo-icon">N</div>
          <span className="logo-text">NEWS PULSE</span>
        </div>
        
        <div className="header-controls">
          {activeJobStatus === "running" && (
            <div 
              style={{
                display: "flex",
                alignItems: "center",
                gap: "0.5rem",
                fontSize: "0.8rem",
                color: "var(--color-amber)",
                background: "rgba(245, 158, 11, 0.05)",
                padding: "0.4rem 0.75rem",
                borderRadius: "6px",
                border: "1px solid rgba(245, 158, 11, 0.15)"
              }}
            >
              <span className="spinner">⏳</span>
              Pipeline Running...
            </div>
          )}

          <button 
            className="btn btn-secondary"
            onClick={() => setShowPipelineModal(true)}
            aria-label="View Ingestion Pipeline Logs"
          >
            📋 Monitor Pipeline
          </button>
          
          <button 
            className="btn btn-primary"
            onClick={triggerPipeline}
            disabled={isTriggering || !!activeJobId}
          >
            Refresh Data
          </button>
        </div>
      </header>

      {/* DASHBOARD BODY */}
      <main className="app-body">
        {/* Left Side: Filter Bar + Timeline Area */}
        <div className="timeline-workspace">
          {/* Filters Dashboard */}
          <section className="filter-bar" aria-label="Filters">
            {/* Search Input */}
            <div className="search-wrapper">
              <span className="search-icon">🔍</span>
              <input
                type="text"
                className="search-input"
                placeholder="Search stories, articles, keywords..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                aria-label="Search"
              />
            </div>

            {/* Date Range Filters */}
            <div className="filter-group">
              <span className="date-picker-label">From</span>
              <input
                type="date"
                className="date-input"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                aria-label="Filter Start Date"
              />
              <span className="date-picker-label">To</span>
              <input
                type="date"
                className="date-input"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
                aria-label="Filter End Date"
              />
            </div>

            {/* Source Toggles */}
            <div className="filter-group" style={{ gap: "0.5rem" }}>
              <span className="date-picker-label" style={{ marginRight: "0.25rem" }}>Sources:</span>
              {availableSources.map(source => {
                const isSelected = selectedSources.includes(source);
                return (
                  <button
                    key={source}
                    className="btn"
                    onClick={() => handleToggleSource(source)}
                    style={{
                      padding: "0.3rem 0.6rem",
                      fontSize: "0.75rem",
                      background: isSelected ? "var(--color-indigo)" : "rgba(255,255,255,0.03)",
                      color: isSelected ? "#fff" : "var(--text-secondary)",
                      border: "1px solid var(--border-subtle)",
                      borderRadius: "6px"
                    }}
                  >
                    {source}
                  </button>
                );
              })}

              {(startDate || endDate || searchQuery || selectedSources.length > 0) && (
                <button
                  className="btn"
                  style={{ padding: "0.4rem 0.8rem", fontSize: "0.8rem", color: "var(--color-rose)" }}
                  onClick={() => {
                    setSearchQuery("");
                    setStartDate("");
                    setEndDate("");
                    setSelectedSources([]);
                  }}
                >
                  Clear
                </button>
              )}
            </div>
          </section>

          {/* Timeline canvas container */}
          {errorMsg ? (
            <div className="timeline-container glass-panel" style={{ margin: "1.5rem" }}>
              <div className="empty-state">
                <div className="empty-state-icon" style={{ color: "var(--color-rose)" }}>⚠</div>
                <h2>Connection Failed</h2>
                <p>{errorMsg}</p>
                <button className="btn btn-primary" onClick={fetchTimelineData}>
                  Retry API Request
                </button>
              </div>
            </div>
          ) : (
            <Timeline
              clusters={filteredClusters}
              selectedArticleId={selectedArticle?.id || null}
              onSelectArticle={handleSelectArticle}
              isLoading={isLoading}
            />
          )}
        </div>

        {/* Right Side: Article details sidebar */}
        <Sidebar
          article={selectedArticle}
          cluster={selectedCluster}
          onClose={handleClearSelection}
          onSelectArticle={handleSelectArticle}
        />

        {/* Pipeline monitor overlay modal */}
        {showPipelineModal && (
          <PipelineStatus
            jobs={pipelineJobs}
            isTriggering={isTriggering}
            onTriggerPipeline={triggerPipeline}
            onClose={() => setShowPipelineModal(false)}
          />
        )}
      </main>
    </div>
  );
}

export default App;
