import type { Input } from '@pulumi/pulumi';
import type { Duration } from '../types/Duration.ts';
import type { SessionPersistenceType } from '../consts/SessionPersistenceType.ts';
import type { CookieConfig } from './CookieConfig.ts';

/**
 * SessionPersistence defines the desired state of SessionPersistence.
 */
export interface SessionPersistence {
  /**
   * SessionName defines the name of the persistent session token
   * which may be reflected in the cookie or the header. Users
   * should avoid reusing session names to prevent unintended
   * consequences, such as rejection or unpredictable behavior.
   *
   * _Support: Implementation-specific_
   */
  sessionName?: Input<string>;

  /**
   * AbsoluteTimeout defines the absolute timeout of the persistent
   * session. Once the AbsoluteTimeout duration has elapsed, the
   * session becomes invalid.
   *
   * _Support: Extended_
   */
  absoluteTimeout?: Input<Duration>;

  /**
   * IdleTimeout defines the idle timeout of the persistent session.
   * Once the session has been idle for more than the specified
   * IdleTimeout duration, the session becomes invalid.
   *
   * _Support: Extended_
   */
  idleTimeout?: Input<Duration>;

  /**
   * Type defines the type of session persistence such as through
   * the use of a header or cookie. Defaults to cookie based session
   * persistence.
   *
   * _Support: Core for "Cookie" type_
   *
   * _Support: Extended for "Header" type_
   *
   */
  type?: Input<SessionPersistenceType>;

  /**
   * CookieConfig provides configuration settings that are specific
   * to cookie-based session persistence.
   *
   * _Support: Core_
   */
  cookieConfig?: Input<CookieConfig>;
}
