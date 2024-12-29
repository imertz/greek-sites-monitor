// server/monitor-server.js

const express = require("express");
const Database = require("better-sqlite3");
const path = require("path");
const fs = require("fs");
const crypto = require("crypto");

class GreekSiteMonitorServer {
  constructor(dbPath = "site_status.db", port = 3002) {
    this.dbPath = dbPath;
    this.port = port;
    this.app = express();
    this.db = new Database(dbPath);
    this.db.pragma("journal_mode = WAL");

    this.batchSize = 5;
    this.initializeDb();
    this.initializeServer();
  }

  initializeDb() {
    // Create users table
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT UNIQUE NOT NULL,
        api_key TEXT UNIQUE NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        last_active DATETIME,
        is_active INTEGER DEFAULT 1
      )
    `);

    // Modify site_status table to include user_id
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS site_status (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        site_name TEXT,
        url TEXT,
        status_code INTEGER,
        response_time REAL,
        is_up INTEGER,
        error_message TEXT,
        timestamp DATETIME,
        user_id INTEGER,
        FOREIGN KEY (user_id) REFERENCES users(id)
      )
    `);
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS monitored_sites (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        site_name TEXT UNIQUE NOT NULL,
        url TEXT NOT NULL,
        category TEXT,
        is_active INTEGER DEFAULT 1,
        last_checked DATETIME,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        user_id INTEGER,
        FOREIGN KEY (user_id) REFERENCES users(id)
      )
    `);

    // Prepare statements
    this.insertStmt = this.db.prepare(`
      INSERT INTO site_status 
      (site_name, url, status_code, response_time, is_up, error_message, timestamp, user_id)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);

    this.getLatestStmt = this.db.prepare(`
      SELECT s.*, u.username
      FROM site_status s
      JOIN users u ON s.user_id = u.id
      WHERE s.id IN (
        SELECT MAX(id)
        FROM site_status
        GROUP BY site_name
      )
      ORDER BY site_name
    `);

    this.findUserByApiKey = this.db.prepare(`
      SELECT * FROM users WHERE api_key = ? AND is_active = 1
    `);

    this.updateUserLastActive = this.db.prepare(`
      UPDATE users SET last_active = CURRENT_TIMESTAMP WHERE id = ?
    `);

    this.createUser = this.db.prepare(`
      INSERT INTO users (username, api_key)
      VALUES (?, ?)
    `);

    // Prepare statements for sites
    this.getSiteBatchStmt = this.db.prepare(`
      WITH DownSites AS (
        SELECT DISTINCT site_name
        FROM site_status
        WHERE id IN (
          SELECT MAX(id)
          FROM site_status
          GROUP BY site_name
        )
        AND is_up = 0
      )
      SELECT ms.site_name, ms.url, ms.category
      FROM monitored_sites ms
      LEFT JOIN DownSites ds ON ms.site_name = ds.site_name
      WHERE ms.is_active = 1 
      AND (
        -- Check if site is down (prioritize these)
        ds.site_name IS NOT NULL 
        AND ms.last_checked < datetime('now', '-1 minute')
        OR
        -- Or if it hasn't been checked in the last 5 minutes
        (ds.site_name IS NULL 
         AND (ms.last_checked IS NULL 
              OR ms.last_checked < datetime('now', '-5 minutes'))
        )
      )
      -- Prioritize down sites first, then by last checked time
      ORDER BY 
        CASE WHEN ds.site_name IS NOT NULL THEN 1 ELSE 2 END,
        ms.last_checked ASC
      LIMIT ?
    `);
    this.checkNeedsSitesStmt = this.db.prepare(`
      WITH DownSites AS (
        SELECT DISTINCT site_name
        FROM site_status
        WHERE id IN (
          SELECT MAX(id)
          FROM site_status
          GROUP BY site_name
        )
        AND is_up = 0
      )
      SELECT COUNT(*) as count
      FROM monitored_sites ms
      LEFT JOIN DownSites ds ON ms.site_name = ds.site_name
      WHERE ms.is_active = 1 
      AND (
        -- Site is down and hasn't been checked in the last minute
        (ds.site_name IS NOT NULL AND ms.last_checked < datetime('now', '-1 minute'))
        OR
        -- Or hasn't been checked in the last 5 minutes
        (ds.site_name IS NULL AND 
         (ms.last_checked IS NULL OR ms.last_checked < datetime('now', '-5 minutes')))
      )
    `);

    this.updateSiteLastCheckedStmt = this.db.prepare(`
      UPDATE monitored_sites
      SET last_checked = CURRENT_TIMESTAMP
      WHERE site_name = ?
    `);

    this.addSiteStmt = this.db.prepare(`
      INSERT INTO monitored_sites (site_name, url, category, user_id)
      VALUES (?, ?, ?, ?)
    `);
  }

  initializeServer() {
    this.app.use(express.json());

    // Middleware to verify API key
    const authenticateApiKey = (req, res, next) => {
      const apiKey = req.header("X-API-Key");

      if (!apiKey) {
        return res.status(401).json({ error: "API key is required" });
      }

      const user = this.findUserByApiKey.get(apiKey);

      if (!user) {
        return res.status(401).json({ error: "Invalid API key" });
      }

      // Update last active timestamp
      this.updateUserLastActive.run(user.id);

      // Add user to request object
      req.user = user;
      next();
    };

    // static files
    this.app.use(express.static("server/public/"));

    // API endpoint to receive monitoring results
    this.app.post("/api/status", authenticateApiKey, (req, res) => {
      try {
        const results = Array.isArray(req.body) ? req.body : [req.body];
        this.saveResults(results, req.user.id);
        res.status(200).json({ message: "Results saved successfully" });
      } catch (error) {
        console.error("Error saving results:", error);
        res.status(500).json({ error: "Error saving results" });
      }
    });

    // API endpoint to get latest status
    this.app.get("/api/status", authenticateApiKey, (req, res) => {
      try {
        const latestStatus = this.getLatestStatus();
        res.status(200).json(latestStatus);
      } catch (error) {
        console.error("Error retrieving status:", error);
        res.status(500).json({ error: "Error retrieving status" });
      }
    });

    // Admin endpoint to create new users (should be protected in production)
    this.app.post("/api/users", (req, res) => {
      try {
        const { username } = req.body;

        if (!username) {
          return res.status(400).json({ error: "Username is required" });
        }

        const apiKey = this.generateApiKey();

        try {
          this.createUser.run(username, apiKey);
          res.status(201).json({ username, apiKey });
        } catch (err) {
          if (err.code === "SQLITE_CONSTRAINT") {
            res.status(400).json({ error: "Username already exists" });
          } else {
            throw err;
          }
        }
      } catch (error) {
        console.error("Error creating user:", error);
        res.status(500).json({ error: "Error creating user" });
      }
    });
    this.app.get("/api/sites/batch", authenticateApiKey, (req, res) => {
      try {
        const sites = this.getNextSiteBatch();
        res.status(200).json(sites);
      } catch (error) {
        console.error("Error retrieving sites batch:", error);
        res.status(500).json({ error: "Error retrieving sites batch" });
      }
    });

    // Endpoint to add new sites
    this.app.post("/api/sites", authenticateApiKey, (req, res) => {
      try {
        const { sites } = req.body;
        if (!Array.isArray(sites)) {
          return res.status(400).json({ error: "Sites must be an array" });
        }

        const addedSites = this.addSites(sites, req.user.id);
        res
          .status(201)
          .json({ message: "Sites added successfully", addedSites });
      } catch (error) {
        console.error("Error adding sites:", error);
        res.status(500).json({ error: "Error adding sites" });
      }
    });
  }

  generateApiKey() {
    return crypto.randomBytes(32).toString("hex");
  }

  saveResults(results, userId) {
    const transaction = this.db.transaction((statusArray) => {
      for (const status of statusArray) {
        this.insertStmt.run(
          status.site_name,
          status.url,
          status.status_code,
          status.response_time,
          status.is_up,
          status.error_message,
          status.timestamp,
          userId
        );
      }
    });

    transaction(results);
    this.updateStatusFile(results);
  }

  getLatestStatus() {
    const results = this.getLatestStmt.all();
    return results.map((result) => ({
      ...result,
      is_up: result.is_up === 1,
    }));
  }
  getSiteCategory(siteName) {
    const categories = {
      government: [
        "gov.gr",
        "gsis",
        "efka",
        "ktimalogio",
        "et.gr",
        "oaed",
        "immigration",
        "passport",
        "eopyy",
      ],
      ministries: [
        "ministry_digital",
        "ministry_finance",
        "ministry_foreign",
        "ministry_interior",
        "ministry_education",
        "ministry_health",
        "ministry_justice",
        "ministry_culture",
        "ministry_tourism",
      ],
      education: ["eudoxus", "myschool", "uoa", "auth", "ntua", "upatras"],
      transportation: ["oasa", "trainose", "athens_airport", "oasth"],
      utilities: ["eydap", "elta", "cosmote", "nova", "vodafone"],
      emergency: ["ekav", "civilprotection", "fireservice", "astynomia"],
      banking: ["bankofgreece", "nbg", "alpha", "eurobank"],
      media: ["ert", "kathimerini", "tovima", "naftemporiki", "in.gr"],
      weather: ["emy", "meteo", "noa"],
      sports: ["gga", "epo", "oaka"],
    };

    for (const [category, sites] of Object.entries(categories)) {
      if (sites.includes(siteName)) {
        return category;
      }
    }
    return "other";
  }
  getNextSiteBatch() {
    // First check if there are any sites that need checking
    const needsCheck = this.checkNeedsSitesStmt.get();

    if (needsCheck.count === 0) {
      return []; // Return empty array if no sites need checking
    }

    const sites = this.getSiteBatchStmt.all(this.batchSize);

    // Update last_checked timestamp for returned sites
    const transaction = this.db.transaction((sitesToUpdate) => {
      for (const site of sitesToUpdate) {
        this.updateSiteLastCheckedStmt.run(site.site_name);
      }
    });

    transaction(sites);
    return sites;
  }

  addSites(sites, userId) {
    const addedSites = [];
    const transaction = this.db.transaction((sitesToAdd) => {
      for (const site of sitesToAdd) {
        try {
          this.addSiteStmt.run(
            site.site_name,
            site.url,
            site.category || "other",
            userId
          );
          addedSites.push(site);
        } catch (error) {
          if (error.code !== "SQLITE_CONSTRAINT") {
            throw error;
          }
          // Skip duplicates silently
        }
      }
    });

    transaction(sites);
    return addedSites;
  }
  updateStatusFile(results) {
    const statusData = {
      lastUpdated: new Date().toISOString(),
      sites: results.map((status) => ({
        name: status.site_name,
        url: status.url,
        isUp: status.is_up === 1,
        responseTime: status.response_time,
        statusCode: status.status_code,
        error: status.error_message || null,
        lastChecked: status.timestamp,
        category: this.getSiteCategory(status.site_name),
      })),
    };

    const publicDir = path.join(__dirname, "public");
    if (!fs.existsSync(publicDir)) {
      fs.mkdirSync(publicDir);
    }

    fs.writeFileSync(
      path.join(publicDir, "public/latest-status.json"),
      JSON.stringify(statusData, null, 2)
    );
  }

  start() {
    this.server = this.app.listen(this.port, () => {
      console.log(`Server running on port ${this.port}`);
    });
  }

  shutdown() {
    if (this.server) {
      this.server.close(() => {
        console.log("Server stopped");
      });
    }

    if (this.db) {
      this.db.close();
      console.log("Database connection closed");
    }
  }
}

// Example usage
if (require.main === module) {
  const server = new GreekSiteMonitorServer();
  server.start();

  // Handle graceful shutdown
  process.on("SIGINT", () => {
    console.log("\nReceived SIGINT. Shutting down...");
    server.shutdown();
    process.exit(0);
  });

  process.on("SIGTERM", () => {
    console.log("\nReceived SIGTERM. Shutting down...");
    server.shutdown();
    process.exit(0);
  });
}

module.exports = GreekSiteMonitorServer;
