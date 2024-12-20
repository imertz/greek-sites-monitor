const axios = require("axios");
const Database = require("better-sqlite3");
const https = require("https");
const fs = require("node:fs");
const path = require("node:path");

// Ignore SSL certificate errors
const agent = new https.Agent({
  rejectUnauthorized: false,
});

class GreekSiteMonitor {
  constructor(dbPath = "site_status.db") {
    this.dbPath = dbPath;
    this.timeout = 10000; // 10 seconds
    this.db = new Database(dbPath);
    this.db.pragma("journal_mode = WAL");

    // Initialize database
    this.initializeDb();

    // Axios instance with custom config
    this.axiosInstance = axios.create({
      timeout: this.timeout,
      httpsAgent: agent,
      maxRedirects: 3,
      validateStatus: function (status) {
        return status >= 200 && status < 600;
      },
    });
    // List of important Greek websites to monitor
    this.sites = {
      "gov.gr": "https://www.gov.gr",
      gsis: "https://www.gsis.gr",
      efka: "https://www.efka.gov.gr",
      ktimalogio: "https://www.ktimatologio.gr",
      "et.gr": "https://www.et.gr",
      oaed: "https://www.dypa.gov.gr",
      immigration: "https://migration.gov.gr",
      passport: "https://www.passport.gov.gr",
      eopyy: "https://www.eopyy.gov.gr",

      // Ministries
      ministry_digital: "https://mindigital.gr",
      ministry_finance: "https://www.minfin.gr",
      ministry_foreign: "https://www.mfa.gr",
      ministry_interior: "https://www.ypes.gr",
      ministry_education: "https://www.minedu.gov.gr",
      ministry_health: "https://www.moh.gov.gr",
      ministry_justice: "https://www.ministryofjustice.gr",
      ministry_culture: "https://www.culture.gov.gr",
      ministry_tourism: "https://mintour.gov.gr",

      // Education
      eudoxus: "https://eudoxus.gr",
      myschool: "https://myschool.sch.gr",
      uoa: "https://www.uoa.gr",
      auth: "https://www.auth.gr",
      ntua: "https://www.ntua.gr",
      upatras: "https://www.upatras.gr",

      // Transportation
      oasa: "https://www.oasa.gr",
      trainose: "https://www.hellenictrain.gr",
      athens_airport: "https://www.aia.gr",
      oasth: "https://oasth.gr",

      // Utilities & Services
      eydap: "https://www.eydap.gr",
      elta: "https://www.elta.gr",
      cosmote: "https://www.cosmote.gr",
      nova: "https://www.nova.gr",
      vodafone: "https://www.vodafone.gr",

      // Emergency Services
      ekav: "https://www.ekab.gr",
      civilprotection: "https://www.civilprotection.gr",
      fireservice: "https://www.fireservice.gr",
      astynomia: "https://www.astynomia.gr",

      // Banking
      bankofgreece: "https://www.bankofgreece.gr",
      nbg: "https://www.nbg.gr",
      alpha: "https://www.alpha.gr",
      eurobank: "https://www.eurobank.gr",

      // News & Media
      ert: "https://www.ert.gr",
      kathimerini: "https://www.kathimerini.gr",
      tovima: "https://www.tovima.gr",
      naftemporiki: "https://www.naftemporiki.gr",
      "in.gr": "https://www.in.gr",

      // Weather & Environment
      emy: "https://www.emy.gr",
      meteo: "https://www.meteo.gr",
      noa: "https://www.noa.gr",

      // Sports
      gga: "https://gga.gov.gr",
      epo: "https://www.epo.gr",
      oaka: "https://www.oaka.com.gr",
    };
  }

  initializeDb() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS site_status (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        site_name TEXT,
        url TEXT,
        status_code INTEGER,
        response_time REAL,
        is_up INTEGER,
        error_message TEXT,
        timestamp DATETIME
      )
    `);

    // Prepare statements for better performance
    this.insertStmt = this.db.prepare(`
      INSERT INTO site_status 
      (site_name, url, status_code, response_time, is_up, error_message, timestamp)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);

    this.getLatestStmt = this.db.prepare(`
      SELECT * FROM site_status
      WHERE id IN (
        SELECT MAX(id)
        FROM site_status
        GROUP BY site_name
      )
      ORDER BY site_name
    `);
  }

  async checkSite(siteName, urlConfig) {
    const startTime = Date.now();
    let url, options;

    if (typeof urlConfig === "string") {
      url = urlConfig;
      options = {};
    } else {
      url = urlConfig.url;
      options = {
        maxRedirects: urlConfig.maxRedirects || 5,
        specialHandling: urlConfig.specialHandling || false,
      };
    }

    try {
      const response = await this.axiosInstance.get(url, {
        ...options,
        maxRedirects: options.maxRedirects,
      });

      const responseTime = (Date.now() - startTime) / 1000;

      return {
        site_name: siteName,
        url,
        status_code: response.status,
        response_time: responseTime,
        is_up: response.status >= 200 && response.status < 400 ? 1 : 0, // Convert boolean to integer
        error_message: null,
        timestamp: new Date().toISOString(),
      };
    } catch (error) {
      const errorMessage = this.formatError(error);
      console.error(`Error checking ${siteName} (${url}):`, errorMessage);

      return {
        site_name: siteName,
        url,
        status_code: error.response?.status || null,
        response_time: null,
        is_up: 0, // Convert boolean to integer
        error_message: errorMessage,
        timestamp: new Date().toISOString(),
      };
    }
  }

  formatError(error) {
    if (error.code === "ERR_FR_TOO_MANY_REDIRECTS") return "Too many redirects";
    if (error.code === "ECONNREFUSED") return "Connection refused";
    if (error.code === "ECONNABORTED") return "Connection timed out";
    if (error.code === "ENOTFOUND") return "DNS lookup failed";
    return error.message || "Unknown error";
  }

  saveStatus(status) {
    this.insertStmt.run(
      status.site_name,
      status.url,
      status.status_code,
      status.response_time,
      status.is_up,
      status.error_message,
      status.timestamp
    );
  }

  async checkAllSites() {
    const batchSize = 5;
    const sites = Object.entries(this.sites);

    // Use a transaction for better performance
    const transaction = this.db.transaction((statuses) => {
      for (const status of statuses) {
        this.saveStatus(status);
      }
    });

    for (let i = 0; i < sites.length; i += batchSize) {
      const batch = sites.slice(i, i + batchSize);
      const promises = batch.map(([siteName, urlConfig]) =>
        this.checkSite(siteName, urlConfig)
      );

      const results = await Promise.allSettled(promises);
      const validResults = results
        .filter((result) => result.status === "fulfilled")
        .map((result) => result.value);

      // Execute transaction with batch results
      transaction(validResults);

      // Log results
      for (const status of validResults) {
        console.log(
          `Checked ${status.site_name}: ${status.is_up ? "UP" : "DOWN"}${
            status.error_message ? ` (${status.error_message})` : ""
          }`
        );
      }
    }
  }

  getLatestStatus() {
    const results = this.getLatestStmt.all();
    // Convert integer back to boolean for display
    return results.map((result) => ({
      ...result,
      is_up: result.is_up === 1,
    }));
  }

  async startScheduledMonitoring(intervalMinutes = 1) {
    console.log(
      `Starting scheduled monitoring every ${intervalMinutes} minute(s)...`
    );

    // Initial run
    await this.runMonitoringCycle();

    // Schedule subsequent runs
    setInterval(async () => {
      await this.runMonitoringCycle();
    }, intervalMinutes * 60 * 1000);
  }

  async runMonitoringCycle() {
    const startTime = new Date();
    console.log(
      `\nStarting monitoring cycle at ${startTime.toLocaleString("en-US", {
        timeZone: "Europe/Athens",
      })}`
    );

    try {
      await this.checkAllSites();

      console.log("\nLatest status for all sites:");
      const latestStatus = this.getLatestStatus();

      // Format the status data
      const statusData = {
        lastUpdated: new Date().toISOString(),
        console: latestStatus,
        sites: latestStatus.map((status) => ({
          name: status.site_name,
          url: status.url,
          isUp: status.is_up,
          responseTime: status.response_time,
          statusCode: status.status_code,
          error: status.error_message || null,
          lastChecked: status.timestamp,
          // Add category based on the site name
          category: this.getSiteCategory(status.site_name),
        })),
      };

      // Save to JSON file
      const publicDir = path.join(__dirname, "public");
      if (!fs.existsSync(publicDir)) {
        fs.mkdirSync(publicDir);
      }
      fs.writeFileSync(
        path.join(publicDir, "latest-status.json"),
        JSON.stringify(statusData, null, 2)
      );

      console.table(
        latestStatus.map((status) => ({
          Site: status.site_name,
          Status: status.is_up ? "UP" : "DOWN",
          "Response Time": status.response_time
            ? `${status.response_time.toFixed(2)}s`
            : "N/A",
          Error: status.error_message || "None",
          "Last Checked": new Date(status.timestamp).toLocaleString("en-US", {
            timeZone: "Europe/Athens",
          }),
        }))
      );

      const endTime = new Date();
      const duration = (endTime - startTime) / 1000;
      console.log(
        `\nMonitoring cycle completed in ${duration.toFixed(2)} seconds`
      );
    } catch (error) {
      console.error("Error during monitoring cycle:", error);
    }
  }

  // Helper method to determine site category
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
  shutdown() {
    try {
      if (this.db) {
        // Close the database connection
        this.db.close();
        console.log("Database connection closed successfully");
      }
    } catch (error) {
      console.error("Error while shutting down:", error);
    }
  }
}

// Example usage with scheduled monitoring
let monitor = null;

async function main() {
  monitor = new GreekSiteMonitor();

  try {
    // Start monitoring every 1 minute
    await monitor.startScheduledMonitoring(1);
  } catch (error) {
    console.error("Error in main:", error);
    if (monitor) monitor.shutdown();
    process.exit(1);
  }

  // Handle graceful shutdown
  process.on("SIGINT", () => {
    console.log("\nReceived SIGINT. Closing database and exiting...");
    if (monitor) monitor.shutdown();
    process.exit(0);
  });

  process.on("SIGTERM", () => {
    console.log("\nReceived SIGTERM. Closing database and exiting...");
    if (monitor) monitor.shutdown();
    process.exit(0);
  });
}

if (require.main === module) {
  main().catch(console.error);
}

module.exports = GreekSiteMonitor;
