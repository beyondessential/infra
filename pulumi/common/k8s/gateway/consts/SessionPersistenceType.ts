export const SessionPersistenceType = {
  /**
   * Specifies cookie-based session persistence.
   *
   * _Support: Core_
   */
  Cookie: 'Cookie',

  /**
   * Specifies header-based session persistence.
   *
   * _Support: Extended_
   */
  Header: 'Header',
} as const;
export type SessionPersistenceType =
  (typeof SessionPersistenceType)[keyof typeof SessionPersistenceType];
