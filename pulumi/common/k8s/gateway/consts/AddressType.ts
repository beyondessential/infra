export const AddressType = {
  /**
   * A textual representation of a numeric IP address. IPv4
   * addresses must be in dotted-decimal form. IPv6 addresses
   * must be in a standard IPv6 text representation
   * (see [RFC 5952](https://tools.ietf.org/html/rfc5952)).
   *
   * This type is intended for specific addresses. Address ranges are not
   * supported (e.g. you cannot use a CIDR range like 127.0.0.0/24 as an
   * IPAddress).
   *
   * _Support: Extended_
   */
  IPAddress: 'IPAddress',

  /**
   * A Hostname represents a DNS based ingress point. This is similar to the
   * corresponding hostname field in Kubernetes load balancer status. For
   * example, this concept may be used for cloud load balancers where a DNS
   * name is used to expose a load balancer.
   *
   * _Support: Extended_
   */
  Hostname: 'Hostname',
} as const;
export type AddressType = (typeof AddressType)[keyof typeof AddressType];
