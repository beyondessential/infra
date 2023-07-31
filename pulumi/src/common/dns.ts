export function truncateDomainIfNeeded(domain: string, zone: string) {
  if (domain.length >= 64) {
    domain = domain.slice(0, 63);
  }

  if (domain.endsWith('-')) {
    domain = domain.slice(0, -1);
  }

  return `${domain}.${zone}`;
}
