export function metricsScrape(port: number = 9090, path: string = '/metrics', slow: boolean = false) {
  return {
    'prometheus.io/scrape': 'true',
    'prometheus.io/path': path,
    'prometheus.io/port': port.toString(),
    'prometheus.io/scrape-slow': slow.toString(),
  };
}
