import type { Input } from '@pulumi/pulumi';

/**
 * SecretObjectReference identifies an API object including its namespace,
 * defaulting to `Secret`.
 *
 * The API object must be valid in the cluster; the Group and Kind must be
 * registered in the cluster for this reference to be valid.
 *
 * References to objects with invalid Group and Kind are not valid, and must
 * be rejected by the implementation, with appropriate Conditions set on the
 * containing object.
 */
export interface SecretObjectReference {
  /**
   * Group of the referent.
   *
   * For example, `gateway.networking.k8s.io`.
   * When unspecified or empty string, core API group is inferred.
   */
  group?: Input<string>;

  /**
   * Kind of the referent.
   *
   * Defaults to `Secret`.
   */
  kind?: Input<string>;

  /**
   * Name of the referent.
   */
  name: Input<string>;

  /**
   * Namespace of the referenced object.
   *
   * When unspecified, the local namespace is inferred.
   *
   * Note that when a namespace different than the local namespace is specified,
   * a ReferenceGrant object is required in the referent namespace to allow that
   * namespace's owner to accept the reference. See the ReferenceGrant
   * documentation for details.
   *
   * _Support: Core_
   */
  namespace?: Input<string>;
}
