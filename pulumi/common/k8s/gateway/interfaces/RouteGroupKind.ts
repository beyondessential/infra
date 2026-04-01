import type { Input } from '@pulumi/pulumi';

/**
 * RouteGroupKind indicates the group and kind of a Route resource.
 */
export interface RouteGroupKind {
  /**
   * Group of the Route.
   *
   * Defaults to `gateway.networking.k8s.io`.
   */
  group?: Input<string>;

  /**
   * Kind of the Route.
   */
  kind: Input<string>;
}
