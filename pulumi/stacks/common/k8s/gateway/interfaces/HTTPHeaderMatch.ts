import type { Input } from '@pulumi/pulumi';
import type { HeaderMatchType } from '../consts/HeaderMatchType.ts';

/**
 * Describes how to select a HTTP route by matching HTTP request headers.
 */
export interface HTTPHeaderMatch {
  /**
   * Type specifies how to match against the value of the header.
   *
   * _Support: Core (Exact)_
   *
   * _Support: Implementation-specific (RegularExpression)_
   *
   * Since RegularExpression HeaderMatchType has implementation-specific
   * conformance, implementations can support POSIX, PCRE or any other dialects
   * of regular expressions. Please read the implementation's documentation to
   * determine the supported dialect.
   */
  type?: Input<HeaderMatchType>;

  /**
   * Name is the name of the HTTP Header to be matched. Name matching MUST be
   * case-insensitive (see <https://tools.ietf.org/html/rfc7230#section-3.2>).
   *
   * If multiple entries specify equivalent header names, only the first
   * entry with an equivalent name MUST be considered for a match. Subsequent
   * entries with an equivalent header name MUST be ignored. Due to the
   * case-insensitivity of header names, "foo" and "Foo" are considered
   * equivalent.
   *
   * When a header is repeated in an HTTP request, it is
   * implementation-specific behavior as to how this is represented.
   * Generally, proxies should follow the guidance from the RFC:
   * <https://www.rfc-editor.org/rfc/rfc7230.html#section-3.2.2> regarding
   * processing a repeated header, with special handling for `Set-Cookie`.
   */
  name: Input<string>;

  /**
   * Value is the value of HTTP Header to be matched.
   *
   * Must consist of printable US-ASCII characters, optionally separated
   * by single tabs or spaces (see <https://tools.ietf.org/html/rfc7230#section-3.2>).
   */
  value: Input<string>;
}
