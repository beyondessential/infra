import type { Input } from '@pulumi/pulumi';

/**
 * Represents an HTTP Header name and value as defined by RFC 7230.
 */
export interface HTTPHeader {
  /**
   * Name is the name of the HTTP Header to be matched. Name matching MUST be
   * case-insensitive. (See <https://tools.ietf.org/html/rfc7230#section-3.2>).
   *
   * If multiple entries specify equivalent header names, the first entry with
   * an equivalent name MUST be considered for a match. Subsequent entries
   * with an equivalent header name MUST be ignored. Due to the
   * case-insensitivity of header names, "foo" and "Foo" are considered
   * equivalent.
   */
  name: Input<string>;

  /**
   * Value is the value of HTTP Header to be matched.
   *
   * Must consist of printable US-ASCII characters, optionally separated
   * by single tabs or spaces. See: <https://tools.ietf.org/html/rfc7230#section-3.2>.
   */
  value: Input<string>;
}
