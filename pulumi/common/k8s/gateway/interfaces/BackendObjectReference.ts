import type { Input } from '@pulumi/pulumi';

/**
 * Defines how an ObjectReference that is specific to BackendRef.
 * It includes a few additional fields and features than a regular ObjectReference.
 *
 * Note that when a namespace different than the local namespace is specified,
 * a ReferenceGrant object is required in the referent namespace to allow that
 * namespace's owner to accept the reference. See the ReferenceGrant documentation
 * for details.
 *
 * The API object must be valid in the cluster; the Group and Kind must be registered
 * in the cluster for this reference to be valid.
 *
 * References to objects with invalid Group and Kind are not valid, and must be rejected
 * by the implementation, with appropriate Conditions set on the containing object.
 */
export interface BackendObjectReference {
  /**
   * Group of the referent.
   *
   * For example, `gateway.networking.k8s.io`.
   *
   * When unspecified or empty string, core API group is inferred.
   */
  group?: Input<string>;

  /**
   * Kind of the referent.
   *
   * Defaults to `Service` when not specified.
   *
   * ExternalName services can refer to CNAME DNS records that may live
   * outside of the cluster and as such are difficult to reason about in
   * terms of conformance. They also may not be safe to forward to (see
   * CVE-2021-25740 for more information). Implementations SHOULD NOT
   * support ExternalName Services.
   *
   * _Support: Core (Services with a type other than ExternalName)_
   *
   * _Support: Implementation-specific (Services with type ExternalName)_
   */
  kind?: Input<string>;

  /**
   * Name of the referent.
   */
  name: Input<string>;

  /**
   * Namespace of the referent.
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

  /**
   * Port specifies the destination port number to use for this resource.
   *
   * Port is required when the referent is a Kubernetes Service. In this
   * case, the port number is the service port number, not the target port.
   *
   * For other resources, destination port might be derived from the referent
   * resource or this field.
   */
  port?: Input<number>;
}
