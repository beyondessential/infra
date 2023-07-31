export function truncateDomainIfNeeded(domain: string, zone: string, wholeDomain: boolean = false) {
  const max = wholeDomain ? 64 - zone.length : 64;

  if (domain.length >= max) {
    domain = domain.slice(0, max - 1);
  }

  if (domain.endsWith('-')) {
    domain = domain.slice(0, -1);
  }

  return `${domain}.${zone}`;
}
