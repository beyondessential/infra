import type { Input } from '@pulumi/pulumi';
import type { SecretObjectReference } from './SecretObjectReference.ts';

/**
 * GatewayBackendTLS describes backend TLS configuration for gateway.
 */
export interface GatewayBackendTLS {
  /**
   * ClientCertificateRef references an object that contains a client certificate
   * and its associated private key. It can reference standard Kubernetes resources,
   * i.e., Secret, or implementation-specific custom resources.
   *
   * A ClientCertificateRef is considered invalid if:
   * - It refers to a resource that cannot be resolved (e.g., the referenced resource
   *   does not exist) or is misconfigured (e.g., a Secret does not contain the keys
   *   named tls.crt and tls.key). In this case, the ResolvedRefs condition
   *   on the Gateway MUST be set to False with the Reason InvalidClientCertificateRef
   *   and the Message of the Condition MUST indicate why the reference is invalid.
   * - It refers to a resource in another namespace UNLESS there is a ReferenceGrant
   *   in the target namespace that allows the certificate to be attached.
   * - If a ReferenceGrant does not allow this reference, the ResolvedRefs condition
   *   on the Gateway MUST be set to False with the Reason RefNotPermitted.
   *
   * Implementations MAY choose to perform further validation of the certificate
   * content (e.g., checking expiry or enforcing specific formats). In such cases,
   * an implementation-specific Reason and Message MUST be set.
   *
   * _Support: Core_ - Reference to a Kubernetes TLS Secret (with the type kubernetes.io/tls).
   *
   * _Support: Implementation-specific_ - Other resource kinds or Secrets with a
   * different type (e.g., Opaque).
   */
  clientCertificateRef?: Input<SecretObjectReference>;
}
