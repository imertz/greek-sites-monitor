module.exports = {
  apps: [
    {
      name: "greek-sites-monitor",
      script: "monitor.js",
      watch: true,
      max_memory_restart: "1G",
      env: {
        NODE_ENV: "production",
      },
      error_file: "logs/error.log",
      out_file: "logs/output.log",
      time: true,
    },
  ],
};
