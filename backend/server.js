import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { open } from 'sqlite';
import sqlite3 from 'sqlite3';
import { spawn } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';

// Load environment variables
dotenv.config();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dbPath = process.env.DATABASE_PATH || path.resolve(__dirname, '../news_pulse.db');
const pythonScriptPath = path.resolve(__dirname, '../pipeline/run.py');

const app = express();
const PORT = process.env.PORT || 8000;

app.use(cors());
app.use(express.json());

// Database connection helper
async function getDb() {
  return open({
    filename: dbPath,
    driver: sqlite3.Database
  });
}

// Global logger middleware
app.use((req, res, next) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.url}`);
  next();
});

// ----------------- API ENDPOINTS -----------------

/**
 * GET /clusters
 * List of topic clusters — label, article count, time range (earliest -> latest article)
 */
app.get('/clusters', async (req, res) => {
  let db;
  try {
    db = await getDb();
    
    // Query list of clusters with metadata
    const query = `
      SELECT c.id, c.title AS label, c.representative_keywords, c.is_active,
             COUNT(ca.article_id) AS article_count,
             MIN(a.published_at) AS earliest_article,
             MAX(a.published_at) AS latest_article
      FROM clusters c
      LEFT JOIN cluster_articles ca ON c.id = ca.cluster_id
      LEFT JOIN articles a ON ca.article_id = a.id
      GROUP BY c.id
      ORDER BY latest_article DESC
    `;
    
    const rows = await db.all(query);
    
    const clusters = rows.map(row => {
      let keywords = [];
      if (row.representative_keywords) {
        try {
          keywords = JSON.parse(row.representative_keywords);
        } catch {
          keywords = row.representative_keywords.split(',').map(k => k.trim());
        }
      }
      
      return {
        id: row.id,
        label: row.label,
        article_count: row.article_count,
        time_range: {
          earliest: row.earliest_article || null,
          latest: row.latest_article || null
        },
        representative_keywords: keywords,
        is_active: !!row.is_active
      };
    });
    
    res.json(clusters);
  } catch (error) {
    console.error('Error fetching clusters:', error);
    res.status(500).json({ error: 'Failed to retrieve clusters' });
  } finally {
    if (db) await db.close();
  }
});

/**
 * GET /clusters/:id
 * Full cluster detail with all articles, sorted chronologically
 */
app.get('/clusters/:id', async (req, res) => {
  const clusterId = parseInt(req.params.id, 10);
  if (isNaN(clusterId)) {
    return res.status(400).json({ error: 'Invalid cluster ID' });
  }
  
  let db;
  try {
    db = await getDb();
    
    // Fetch cluster base information
    const clusterRow = await db.get('SELECT * FROM clusters WHERE id = ?', [clusterId]);
    if (!clusterRow) {
      return res.status(404).json({ error: 'Cluster not found' });
    }
    
    // Fetch nested articles sorted chronologically
    const articlesQuery = `
      SELECT a.id, a.title, a.summary, a.content, a.url, a.source, a.author, a.published_at, ca.similarity_score
      FROM articles a
      JOIN cluster_articles ca ON a.id = ca.article_id
      WHERE ca.cluster_id = ?
      ORDER BY a.published_at ASC
    `;
    
    const articleRows = await db.all(articlesQuery, [clusterId]);
    
    let keywords = [];
    if (clusterRow.representative_keywords) {
      try {
        keywords = JSON.parse(clusterRow.representative_keywords);
      } catch {
        keywords = clusterRow.representative_keywords.split(',').map(k => k.trim());
      }
    }
    
    res.json({
      id: clusterRow.id,
      label: clusterRow.title,
      description: clusterRow.description,
      representative_keywords: keywords,
      is_active: !!clusterRow.is_active,
      articles: articleRows.map(row => ({
        id: row.id,
        title: row.title,
        summary: row.summary,
        url: row.url,
        source: row.source,
        author: row.author,
        published_at: row.published_at,
        similarity_score: row.similarity_score
      }))
    });
  } catch (error) {
    console.error(`Error fetching cluster ${clusterId}:`, error);
    res.status(500).json({ error: 'Failed to retrieve cluster details' });
  } finally {
    if (db) await db.close();
  }
});

/**
 * GET /timeline
 * Clusters formatted for plotting: label, start/end time, article count, a size/intensity metric
 */
app.get('/timeline', async (req, res) => {
  let db;
  try {
    db = await getDb();
    
    // We fetch a detailed flat query containing clusters and articles, which is highly efficient
    const query = `
      SELECT c.id AS cluster_id, c.title AS cluster_label, c.representative_keywords,
             a.id AS article_id, a.title AS article_title, a.source AS article_source,
             a.published_at AS article_published_at, a.url AS article_url, ca.similarity_score
      FROM clusters c
      JOIN cluster_articles ca ON c.id = ca.cluster_id
      JOIN articles a ON ca.article_id = a.id
      ORDER BY c.id, a.published_at ASC
    `;
    
    const rows = await db.all(query);
    
    // Group flat rows into timeline nodes in JS
    const clusterMap = new Map();
    
    for (const row of rows) {
      if (!clusterMap.has(row.cluster_id)) {
        let keywords = [];
        if (row.representative_keywords) {
          try {
            keywords = JSON.parse(row.representative_keywords);
          } catch {
            keywords = row.representative_keywords.split(',').map(k => k.trim());
          }
        }
        
        clusterMap.set(row.cluster_id, {
          id: row.cluster_id,
          label: row.cluster_label,
          representative_keywords: keywords,
          articles: []
        });
      }
      
      const cluster = clusterMap.get(row.cluster_id);
      cluster.articles.push({
        id: row.article_id,
        title: row.article_title,
        source: row.article_source,
        published_at: row.article_published_at,
        url: row.article_url,
        similarity_score: row.similarity_score
      });
    }
    
    const timelineData = Array.from(clusterMap.values()).map(c => {
      const times = c.articles.map(a => new Date(a.published_at).getTime());
      const startTime = new Date(Math.min(...times)).toISOString();
      const endTime = new Date(Math.max(...times)).toISOString();
      
      return {
        id: c.id,
        label: c.label,
        start_time: startTime,
        end_time: endTime,
        article_count: c.articles.length,
        size_metric: c.articles.length, // size maps to volume of articles
        representative_keywords: c.representative_keywords,
        article_associations: c.articles.map(a => ({
          similarity_score: a.similarity_score,
          article: {
            id: a.id,
            title: a.title,
            source: a.source,
            published_at: a.published_at,
            url: a.url
          }
        }))
      };
    });
    
    // Sort timeline clusters by latest activity (end_time) descending
    timelineData.sort((a, b) => new Date(b.end_time).getTime() - new Date(a.end_time).getTime());
    
    res.json(timelineData);
  } catch (error) {
    console.error('Error fetching timeline data:', error);
    res.status(500).json({ error: 'Failed to retrieve timeline data' });
  } finally {
    if (db) await db.close();
  }
});

/**
 * POST /ingest/trigger
 * Triggers python pipeline (scrape + group) as a subprocess; returns a job ID
 */
app.post('/ingest/trigger', async (req, res) => {
  let db;
  let jobId;
  try {
    db = await getDb();
    
    // Insert new pending job record
    const result = await db.run(
      "INSERT INTO jobs (status, articles_fetched, articles_clustered, started_at) VALUES ('running', 0, 0, datetime('now'))"
    );
    jobId = result.lastID;
    
    // Close db session before launching child process to avoid locks
    await db.close();
    db = null;
    
    console.log(`Triggered pipeline background process for Job #${jobId}`);
    
    // Spawn python pipeline script as subprocess with working directory set to workspace root
    const workspaceRoot = path.resolve(__dirname, '..');
    const pythonProcess = spawn('python', [pythonScriptPath], { cwd: workspaceRoot });
    
    let stdoutBuffer = '';
    let stderrBuffer = '';
    
    pythonProcess.stdout.on('data', (data) => {
      stdoutBuffer += data.toString();
    });
    
    pythonProcess.stderr.on('data', (data) => {
      stderrBuffer += data.toString();
    });
    
    pythonProcess.on('close', async (code) => {
      console.log(`Pipeline process for Job #${jobId} exited with code ${code}`);
      
      let updateDb;
      try {
        updateDb = await getDb();
        
        if (code === 0) {
          // Fetch counts to update job log
          const articleCount = await updateDb.get('SELECT COUNT(*) AS count FROM articles');
          const clusterCount = await updateDb.get('SELECT COUNT(*) AS count FROM clusters');
          
          await updateDb.run(
            `UPDATE jobs 
             SET status = 'completed', 
                 articles_fetched = 0, -- delta scraping logic handled in runner
                 articles_clustered = ?, 
                 completed_at = datetime('now') 
             WHERE id = ?`,
            [articleCount.count, jobId]
          );
        } else {
          // Log failed status with error output
          await updateDb.run(
            `UPDATE jobs 
             SET status = 'failed', 
                 error_log = ?, 
                 completed_at = datetime('now') 
             WHERE id = ?`,
            [stderrBuffer || stdoutBuffer || `Exited with code ${code}`, jobId]
          );
        }
      } catch (err) {
        console.error(`Failed to update Job #${jobId} status in database:`, err);
      } finally {
        if (updateDb) await updateDb.close();
      }
    });
    
    // Return job ID immediately with 202 Accepted
    res.status(202).json({
      jobId: jobId,
      message: "Ingestion and clustering pipeline triggered asynchronously in background."
    });
    
  } catch (error) {
    console.error('Error triggering ingestion pipeline:', error);
    res.status(500).json({ error: 'Failed to trigger ingestion pipeline' });
  } finally {
    if (db) await db.close();
  }
});

/**
 * GET /ingest/jobs
 * Returns a list of all historical ingestion and clustering jobs
 */
app.get('/ingest/jobs', async (req, res) => {
  let db;
  try {
    db = await getDb();
    const rows = await db.all('SELECT * FROM jobs ORDER BY started_at DESC LIMIT 20');
    res.json(rows);
  } catch (error) {
    console.error('Error fetching jobs history:', error);
    res.status(500).json({ error: 'Failed to retrieve jobs history' });
  } finally {
    if (db) await db.close();
  }
});

/**
 * GET /ingest/status/:jobId
 * Lets the frontend poll job status
 */
app.get('/ingest/status/:jobId', async (req, res) => {
  const jobId = parseInt(req.params.jobId, 10);
  if (isNaN(jobId)) {
    return res.status(400).json({ error: 'Invalid Job ID' });
  }
  
  let db;
  try {
    db = await getDb();
    
    const row = await db.get('SELECT * FROM jobs WHERE id = ?', [jobId]);
    if (!row) {
      return res.status(404).json({ error: 'Job not found' });
    }
    
    res.json({
      id: row.id,
      status: row.status,
      articles_fetched: row.articles_fetched,
      articles_clustered: row.articles_clustered,
      error_log: row.error_log,
      started_at: row.started_at,
      completed_at: row.completed_at
    });
  } catch (error) {
    console.error(`Error checking status for Job #${jobId}:`, error);
    res.status(500).json({ error: 'Failed to retrieve job status' });
  } finally {
    if (db) await db.close();
  }
});

// Start listening
app.listen(PORT, '0.0.0.0', () => {
  console.log(`Node.js Express backend server listening on http://0.0.0.0:${PORT}`);
});
