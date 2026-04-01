export const CookieLifetimeType = {
  /**
   * Specifies the type for a session cookie.
   *
   * _Support: Core_
   */
  Session: 'Session',

  /**
   * Specifies the type for a permanent cookie.
   *
   * _Support: Extended_
   */
  Permanent: 'Permanent',
} as const;
export type CookieLifetimeType = (typeof CookieLifetimeType)[keyof typeof CookieLifetimeType];
