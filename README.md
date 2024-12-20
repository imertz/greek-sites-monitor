# Greek Sites Monitor

A Node.js application for monitoring the availability and response times of important Greek government, educational, and public service websites. The monitor runs automatic checks every minute and stores results in a SQLite database.

## Features

- Automated monitoring every minute
- Monitors 50+ important Greek websites including:

  - Government portals (gov.gr, gsis.gr)
  - Educational institutions
  - Public utilities
  - Emergency services
  - Banking services
  - News media
  - Transportation services

- Provides detailed status tracking:

  - Response time measurement
  - Status code monitoring
  - Error logging
  - Historical data storage
  - Real-time status updates

- Performance optimized:
  - Batch processing of requests
  - SQLite database with WAL mode
  - Prepared statements
  - Transaction support
  - Graceful shutdown handling

## Prerequisites

- Node.js (v14 or higher)
- npm

## Installation

1. Clone the repository:

```bash
git clone https://github.com/yourusername/greek-sites-monitor.git
cd greek-sites-monitor
```

2. Install dependencies:

```bash
npm install
```

## Usage

### Development Mode

Run the monitor directly with Node.js:

```bash
npm start
```

### Production Mode

For production environments, it's recommended to use PM2:

1. Install PM2 globally:

```bash
npm install -g pm2
```

2. Start the monitor:

```bash
npm run start:pm2
```

3. Other PM2 commands:

```bash
# Stop the monitor
npm run stop:pm2

# View logs
npm run logs
```

The application will:

1. Start monitoring all configured websites
2. Run checks every minute in batches
3. Store results in an SQLite database
4. Display a summary table after each monitoring cycle
5. Handle graceful shutdown on SIGINT and SIGTERM signals

## Database

The application uses SQLite to store monitoring results with the following schema:

```sql
CREATE TABLE site_status (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  site_name TEXT,
  url TEXT,
  status_code INTEGER,
  response_time REAL,
  is_up INTEGER,
  error_message TEXT,
  timestamp DATETIME
)
```

## Configuration

### Monitor Settings

Key configurations in `monitor.js`:

- `timeout`: Default 10 seconds
- `batchSize`: Number of concurrent checks (default 5)
- `intervalMinutes`: Monitoring interval (default 1 minute)

### PM2 Configuration

The application includes a `ecosystem.config.js` file for PM2 with:

- Automatic restart on crashes
- Memory limit of 1GB
- Log rotation
- Environment variables

## Error Handling

The monitor handles various network errors including:

- DNS lookup failures
- Connection timeouts
- SSL certificate issues
- Too many redirects
- Connection refused errors

## Graceful Shutdown

The application implements graceful shutdown handling:

- Properly closes database connections
- Handles SIGINT and SIGTERM signals
- Ensures data integrity on exit

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## Author

Ioannis Mertzanis

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

## Support

If you find any bugs or have feature requests, please create an issue on GitHub.
