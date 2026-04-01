import type { Input } from '@pulumi/pulumi';
import type { RouteNamespaces } from './RouteNamespaces.ts';
import type { RouteGroupKind } from './RouteGroupKind.ts';

/**
 * AllowedRoutes defines which Routes may be attached to this Listener.
 */
export interface AllowedRoutes {
  /**
   * Indicates namespaces from which Routes may be attached to this Listener.
   *
   * This is restricted to the namespace of this Gateway by default.
   *
   * _Support: Core_
   */
  namespaces?: Input<RouteNamespaces>;

  /**
   * Kinds specifies the groups and kinds of Routes that are allowed to bind
   * to this Gateway Listener. When unspecified or empty, the kinds of Routes
   * selected are determined using the Listener protocol.
   *
   * A RouteGroupKind MUST correspond to kinds of Routes that are compatible
   * with the application protocol specified in the Listener's Protocol field.
   *
   * If an implementation does not support or recognize this resource type, it
   * MUST set the "ResolvedRefs" condition to False for this Listener with the
   * "InvalidRouteKinds" reason.
   *
   * _Support: Core_
   */
  kinds?: Input<Array<Input<RouteGroupKind>>>;
}
