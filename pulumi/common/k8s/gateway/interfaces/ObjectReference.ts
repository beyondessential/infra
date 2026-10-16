import type { Input } from '@pulumi/pulumi';

/**
 * ObjectReference identifies an API object including its namespace.
 *
 * The API object must be valid in the cluster; the Group and Kind must
 * be registered in the cluster for this reference to be valid.
 *
 * References to objects with invalid Group and Kind are not valid, and
 * must be rejected by the implementation, with appropriate Conditions
 * set on the containing object.
 */
export interface ObjectReference {
  /**
   * Group of the referent.
   *
   * For example, `gateway.networking.k8s.io`.
   */
  group: Input<string>;

  /**
   * Kind of the referent.
   */
  kind: Input<string>;

  /**
   * Name of the referent.
   */
  name: Input<string>;

  /**
   * Namespace of the referent.
   */
  namespace: Input<string>;
}
