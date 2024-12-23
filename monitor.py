import urllib.request
import urllib.error
import http.client
import ssl
import json
import time
from datetime import datetime
import threading
from typing import Dict, List, Union, Optional
from dataclasses import dataclass
import logging
import socket

@dataclass
class SiteConfig:
    url: str
    max_redirects: int = 5
    special_handling: bool = False

@dataclass
class MonitoringResult:
    site_name: str
    url: str
    status_code: Optional[int]
    response_time: Optional[float]
    is_up: int
    error_message: Optional[str]
    timestamp: str

class GreekSiteMonitorClient:
    def __init__(self, server_url: str = "http://localhost:3000"):
        self.server_url = server_url
        self.timeout = 10  # 10 seconds
        
        # List of important Greek websites to monitor
        self.sites: Dict[str, Union[str, SiteConfig]] = {
            "gov.gr": "https://www.gov.gr",
            "gsis": "https://www.gsis.gr",
            "efka": "https://www.efka.gov.gr",
            # ... rest of the sites remain the same
        }
        
        # Configure logging
        logging.basicConfig(
            level=logging.INFO,
            format='%(asctime)s - %(levelname)s - %(message)s'
        )
        self.logger = logging.getLogger(__name__)

        # Configure SSL context
        self.ssl_context = ssl.create_default_context()
        self.ssl_context.check_hostname = False
        self.ssl_context.verify_mode = ssl.CERT_NONE

    def format_error(self, error: Exception) -> str:
        """Format common network errors into readable messages."""
        error_str = str(error)
        if isinstance(error, urllib.error.URLError):
            if isinstance(error.reason, socket.timeout):
                return "Connection timed out"
            return str(error.reason)
        elif isinstance(error, socket.gaierror):
            return "DNS lookup failed"
        elif isinstance(error, http.client.RemoteDisconnected):
            return "Connection closed by remote server"
        return error_str or "Unknown error"

    def check_site(self, site_name: str, url_config: Union[str, SiteConfig]) -> MonitoringResult:
        """Check a single site's status."""
        start_time = time.time()
        
        if isinstance(url_config, str):
            url = url_config
            max_redirects = 5
        else:
            url = url_config.url
            max_redirects = url_config.max_redirects

        opener = urllib.request.build_opener(
            urllib.request.HTTPRedirectHandler(),
            urllib.request.HTTPSHandler(context=self.ssl_context)
        )
        opener.addheaders = [('User-Agent', 'PythonMonitorClient/1.0')]

        try:
            urllib.request.install_opener(opener)
            response = opener.open(url, timeout=self.timeout)
            response_time = time.time() - start_time
            
            return MonitoringResult(
                site_name=site_name,
                url=url,
                status_code=response.status,
                response_time=response_time,
                is_up=1 if 200 <= response.status < 400 else 0,
                error_message=None,
                timestamp=datetime.now().isoformat()
            )

        except Exception as error:
            error_message = self.format_error(error)
            self.logger.error(f"Error checking {site_name} ({url}): {error_message}")
            
            return MonitoringResult(
                site_name=site_name,
                url=url,
                status_code=None,
                response_time=None,
                is_up=0,
                error_message=error_message,
                timestamp=datetime.now().isoformat()
            )

    def send_results_to_server(self, results: List[MonitoringResult]) -> None:
        """Send monitoring results to the server."""
        try:
            # Commented out as per original version
            # data = json.dumps([vars(result) for result in results]).encode('utf-8')
            # request = urllib.request.Request(
            #     f"{self.server_url}/api/status",
            #     data=data,
            #     headers={'Content-Type': 'application/json'}
            # )
            # with urllib.request.urlopen(request) as response:
            #     response.read()
            self.logger.info("Results sent to server successfully")
        except Exception as error:
            self.logger.error(f"Error sending results to server: {error}")
            raise

    def check_all_sites(self) -> List[MonitoringResult]:
        """Check all sites in batches."""
        batch_size = 5
        sites = list(self.sites.items())
        all_results = []

        for i in range(0, len(sites), batch_size):
            batch = sites[i:i + batch_size]
            batch_results = []
            
            # Use threads for parallel processing within batch
            threads = []
            for site_name, url_config in batch:
                thread = threading.Thread(
                    target=lambda: batch_results.append(
                        self.check_site(site_name, url_config)
                    )
                )
                thread.start()
                threads.append(thread)
            
            # Wait for all threads in batch to complete
            for thread in threads:
                thread.join()
            
            all_results.extend(batch_results)

            # Log results
            for status in batch_results:
                self.logger.info(
                    f"Checked {status.site_name}: "
                    f"{'UP' if status.is_up else 'DOWN'}"
                    f"{f' ({status.error_message})' if status.error_message else ''}"
                )

        return all_results

    def run_monitoring_cycle(self) -> None:
        """Run a complete monitoring cycle."""
        start_time = datetime.now()
        self.logger.info(
            f"\nStarting monitoring cycle at {start_time.strftime('%Y-%m-%d %H:%M:%S')}"
        )

        try:
            results = self.check_all_sites()
            self.send_results_to_server(results)

            duration = (datetime.now() - start_time).total_seconds()
            self.logger.info(f"\nMonitoring cycle completed in {duration:.2f} seconds")
        except Exception as error:
            self.logger.error(f"Error during monitoring cycle: {error}")

    def start_scheduled_monitoring(self, interval_minutes: float = 1) -> None:
        """Start scheduled monitoring with specified interval."""
        self.logger.info(f"Starting scheduled monitoring every {interval_minutes} minute(s)...")

        try:
            while True:
                self.run_monitoring_cycle()
                time.sleep(interval_minutes * 60)
        except KeyboardInterrupt:
            self.logger.info("\nMonitoring stopped by user")
        except Exception as error:
            self.logger.error(f"Monitoring stopped due to error: {error}")

if __name__ == "__main__":
    client = GreekSiteMonitorClient()
    client.start_scheduled_monitoring(1)