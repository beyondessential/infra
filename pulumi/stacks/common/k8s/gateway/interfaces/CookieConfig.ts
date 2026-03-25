import type { Input } from '@pulumi/pulumi';
import type { CookieLifetimeType } from '../consts/CookieLifetimeType.ts';

/**
 * CookieConfig defines the configuration for cookie-based session persistence.
 */
export interface CookieConfig {
  /**
   * LifetimeType specifies whether the cookie has a permanent or
   * session-based lifetime. A permanent cookie persists until its
   * specified expiry time, defined by the Expires or Max-Age cookie
   * attributes, while a session cookie is deleted when the current
   * session ends.
   *
   * When set to `Permanent`, AbsoluteTimeout indicates the
   * cookie's lifetime via the Expires or Max-Age cookie attributes
   * and is required.
   *
   * When set to `Session`, AbsoluteTimeout indicates the
   * absolute lifetime of the cookie tracked by the gateway and
   * is optional.
   *
   * Defaults to `Session`.
   *
   * _Support: Core for `Session` type_
   *
   * _Support: Extended for `Permanent` type_
   */
  lifetimeType: Input<CookieLifetimeType>;
}
