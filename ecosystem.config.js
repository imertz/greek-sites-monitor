// ecosystem.config.js

module.exports = {
  apps: [
    {
      name: "greek-sites-monitor-server",
      script: "server/server.js",
      watch: true,
      max_memory_restart: "1G",
      env: {
        NODE_ENV: "production",
        PORT: 3002,
      },
      error_file: "logs/server-error.log",
      out_file: "logs/server-output.log",
      time: true,
    },
    {
      name: "greek-sites-monitor-client",
      script: "client/monitor-client.js",
      watch: true,
      max_memory_restart: "512M",
      env: {
        NODE_ENV: "production",
        SERVER_URL: "http://localhost:3002",
        API_KEY: "your-api-key-here", // Replace with actual API key
      },
      error_file: "logs/client-error.log",
      out_file: "logs/client-output.log",
      time: true,
    },
  ],
};
