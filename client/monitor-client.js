// client/monitor-client.js

const axios = require("axios");
const https = require("https");

class GreekSiteMonitorClient {
  constructor(config = {}) {
    const {
      serverUrl = "http://localhost:3000",
      apiKey,
      timeout = 10000,
    } = config;

    if (!apiKey) {
      throw new Error("API key is required");
    }

    this.serverUrl = serverUrl;
    this.timeout = timeout;
    this.axiosInstance = axios.create({
      timeout: this.timeout,
      httpsAgent: new https.Agent({ rejectUnauthorized: false }),
      maxRedirects: 3,
      validateStatus: function (status) {
        return status >= 200 && status < 600;
      },
    });

    // Axios instance for server communication
    this.serverAxiosInstance = axios.create({
      baseURL: this.serverUrl,
      timeout: this.timeout,
      headers: {
        "X-API-Key": apiKey,
        "Content-Type": "application/json",
      },
    });

    // List of important Greek websites to monitor
    this.sites = {
      "gov.gr": "https://www.gov.gr",
      gsis: "https://www.gsis.gr",
      efka: "https://www.efka.gov.gr",
      // ... rest of the sites remain the same
    };
  }

  formatError(error) {
    if (error.code === "ERR_FR_TOO_MANY_REDIRECTS") return "Too many redirects";
    if (error.code === "ECONNREFUSED") return "Connection refused";
    if (error.code === "ECONNABORTED") return "Connection timed out";
    if (error.code === "ENOTFOUND") return "DNS lookup failed";
    return error.message || "Unknown error";
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
        is_up: response.status >= 200 && response.status < 400 ? 1 : 0,
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
        is_up: 0,
        error_message: errorMessage,
        timestamp: new Date().toISOString(),
      };
    }
  }

  async sendResultsToServer(results) {
    try {
      await this.serverAxiosInstance.post("/api/status", results);
      console.log("Results sent to server successfully");
    } catch (error) {
      if (error.response?.status === 401) {
        console.error("Authentication failed: Invalid or missing API key");
      } else {
        console.error("Error sending results to server:", error.message);
      }
      throw error;
    }
  }

  async checkAllSites() {
    const batchSize = 5;
    const sites = Object.entries(this.sites);
    const allResults = [];

    for (let i = 0; i < sites.length; i += batchSize) {
      const batch = sites.slice(i, i + batchSize);
      const promises = batch.map(([siteName, urlConfig]) =>
        this.checkSite(siteName, urlConfig)
      );

      const results = await Promise.allSettled(promises);
      const validResults = results
        .filter((result) => result.status === "fulfilled")
        .map((result) => result.value);

      allResults.push(...validResults);

      // Log results
      for (const status of validResults) {
        console.log(
          `Checked ${status.site_name}: ${status.is_up ? "UP" : "DOWN"}${
            status.error_message ? ` (${status.error_message})` : ""
          }`
        );
      }
    }

    return allResults;
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
      const results = await this.checkAllSites();
      await this.sendResultsToServer(results);

      const endTime = new Date();
      const duration = (endTime - startTime) / 1000;
      console.log(
        `\nMonitoring cycle completed in ${duration.toFixed(2)} seconds`
      );
    } catch (error) {
      console.error("Error during monitoring cycle:", error);
    }
  }
}

if (require.main === module) {
  const apiKey = process.env.API_KEY;
  if (!apiKey) {
    console.error("API_KEY environment variable is required");
    process.exit(1);
  }

  const client = new GreekSiteMonitorClient({
    serverUrl: process.env.SERVER_URL || "http://localhost:3000",
    apiKey: apiKey,
  });

  client.startScheduledMonitoring(1).catch(console.error);
}

module.exports = GreekSiteMonitorClient;
