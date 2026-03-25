import type { Input } from '@pulumi/pulumi';
import type { ObjectReference } from './ObjectReference.ts';
import type { FrontendValidationModeType } from '../consts/FrontendValidationModeType.ts';

/**
 * FrontendTLSValidation holds configuration information that can be used
 * to validate the frontend initiating the TLS connection.
 */
export interface FrontendTLSValidation {
  /**
   * CACertificateRefs contains one or more references to Kubernetes
   * objects that contain a PEM-encoded TLS CA certificate bundle, which
   * is used as a trust anchor to validate the certificates presented by
   * the client.
   *
   * A CACertificateRef is invalid if:
   * - It refers to a resource that cannot be resolved (e.g., the
   *   referenced resource does not exist) or is misconfigured (e.g., a
   *   ConfigMap does not contain a key named ca.crt). In this case, the
   *   Reason on all matching HTTPS listeners must be set to InvalidCACertificateRef
   *   and the Message of the Condition must indicate which reference is invalid and why.
   * - It refers to an unknown or unsupported kind of resource. In this
   *   case, the Reason on all matching HTTPS listeners must be set to
   *   InvalidCACertificateKind and the Message of the Condition must explain
   *   which kind of resource is unknown or unsupported.
   * - It refers to a resource in another namespace UNLESS there is a
   *   ReferenceGrant in the target namespace that allows the CA
   *   certificate to be attached. If a ReferenceGrant does not allow this
   *   reference, the ResolvedRefs on all matching HTTPS listeners condition
   *   MUST be set with the Reason RefNotPermitted.
   *
   * Implementations MAY choose to perform further validation of the
   * certificate content (e.g., checking expiry or enforcing specific formats).
   * In such cases, an implementation-specific Reason and Message MUST be set.
   *
   * In all cases, the implementation MUST ensure that the ResolvedRefs
   * condition is set to status: False on all targeted listeners (i.e.,
   * listeners serving HTTPS on a matching port). The condition MUST
   * include a Reason and Message that indicate the cause of the error. If
   * ALL CACertificateRefs are invalid, the implementation MUST also ensure
   * the Accepted condition on the listener is set to status: False, with
   * the Reason NoValidCACertificate.
   *
   * Implementations MAY choose to support attaching multiple CA certificates
   * to a listener, but this behavior is implementation-specific.
   *
   * _Support: Core_ - A single reference to a Kubernetes ConfigMap, with the
   * CA certificate in a key named ca.crt.
   *
   * _Support: Implementation-specific_ - More than one reference, other kinds
   * of resources, or a single reference that includes multiple certificates.
   */
  caCertificateRefs: Input<Array<Input<ObjectReference>>>;

  /**
   * FrontendValidationMode defines the mode for validating the client certificate.
   *
   * There are two possible modes:
   * - `AllowValidOnly`: In this mode, the gateway will accept connections only if
   *   the client presents a valid certificate. This certificate must successfully
   *   pass validation against the CA certificates specified in CACertificateRefs.
   * - `AllowInsecureFallback`: In this mode, the gateway will accept connections
   *   even if the client certificate is not presented or fails verification.
   *   This approach delegates client authorization to the backend and introduce
   *   a significant security risk. It should be used in testing environments or
   *   on a temporary basis in non-testing environments.
   *
   * Defaults to `AllowValidOnly`.
   *
   * _Support: Core_
   */
  mode?: Input<FrontendValidationModeType>;
}
