import type { Input } from '@pulumi/pulumi';
import type { LocalParametersRef } from './LocalParametersRef.ts';

/**
 * Defines infrastructure level attributes about a Gateway instance.
 */
export interface GatewayInfrastructure {
  /**
   * Labels that SHOULD be applied to any resources created in response to this Gateway.
   *
   * For implementations creating other Kubernetes objects,
   * this should be the `metadata.labels` field on resources.
   *
   * For other implementations, this refers to any relevant (implementation specific)
   * "labels" concepts.
   *
   * An implementation may chose to add additional implementation-specific labels
   * as they see fit.
   *
   * If an implementation maps these labels to Pods, or any other resource that
   * would need to be recreated when labels change, it SHOULD clearly warn about
   * this behavior in documentation.
   *
   * _Support: Extended_
   */
  labels?: Input<{ [key: string]: Input<string> }>;

  /**
   * Annotations that SHOULD be applied to any resources created in response to this Gateway.
   *
   * For implementations creating other Kubernetes objects, this should be
   * the `metadata.annotations` field on resources.
   *
   * For other implementations, this refers to any relevant (implementation specific)
   * "annotations" concepts.
   *
   * An implementation may chose to add additional implementation-specific
   * annotations as they see fit.
   *
   * _Support: Extended_
   */
  annotations?: Input<{ [key: string]: Input<string> }>;

  /**
   * ParametersRef is a reference to a resource that contains the configuration
   * parameters corresponding to the Gateway. This is optional if the
   * controller does not require any additional configuration.
   *
   * This follows the same semantics as GatewayClass's parametersRef, but on a
   * per-Gateway basis.
   *
   * The Gateway's GatewayClass may provide its own parametersRef.
   * When both are specified, the merging behavior is implementation specific.
   *
   * It is generally recommended that GatewayClass provides defaults that can
   * be overridden by a Gateway.
   *
   * If the referent cannot be found, refers to an unsupported kind, or when
   * the data within that resource is malformed, the Gateway SHOULD be
   * rejected with the "Accepted" status condition set to "False" and an
   * "InvalidParameters" reason.
   *
   * _Support: Implementation-specific_
   */
  parametersRef?: Input<LocalParametersRef>;
}
