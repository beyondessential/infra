export function metricsScrape(port: number = 9090, path: string = '/metrics') {
  return {
    'prometheus.io/scrape': 'true',
    'prometheus.io/path': path,
    'prometheus.io/port': port.toString(),
  };
}
