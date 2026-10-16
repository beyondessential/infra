import type { Input } from '@pulumi/pulumi';
import type { TLSModeType } from '../consts/TLSModeType.ts';
import type { SecretObjectReference } from './SecretObjectReference.ts';

/**
 * ListenerTLSConfig describes a TLS configuration for a listener.
 */
export interface ListenerTLSConfig {
  /**
   * Mode defines the TLS behavior for the TLS session initiated by the client.
   *
   * There are two possible modes:
   * - `Terminate`: The TLS session between the downstream client and the
   *   Gateway is terminated at the Gateway. This mode requires certificates
   *   to be specified in some way, such as populating the certificateRefs
   *   field.
   * - `Passthrough`: The TLS session is NOT terminated by the Gateway. This
   *   implies that the Gateway can't decipher the TLS stream except for
   *   the ClientHello message of the TLS protocol. The certificateRefs field
   *   is ignored in this mode.
   *
   * _Support: Core_
   */
  mode?: Input<TLSModeType>;

  /**
   * CertificateRefs contains a series of references (max 64) to Kubernetes objects that
   * contains TLS certificates and private keys. These certificates are used to
   * establish a TLS handshake for requests that match the hostname of the
   * associated listener.
   *
   * A single CertificateRef to a Kubernetes Secret has _Core_ support.
   * Implementations MAY choose to support attaching multiple certificates to
   * a Listener, but this behavior is implementation-specific.
   *
   * References to a resource in different namespace are invalid UNLESS there
   * is a ReferenceGrant in the target namespace that allows the certificate
   * to be attached. If a ReferenceGrant does not allow this reference, the
   * `ResolvedRefs` condition MUST be set to False for this listener with the
   * `RefNotPermitted` reason.
   *
   * This field is required to have at least one element when the mode is set
   * to `Terminate` (default) and is optional otherwise.
   *
   * CertificateRefs can reference to standard Kubernetes resources, i.e.
   * Secret, or implementation-specific custom resources.
   *
   * _Support: Core_ (A single reference to a Kubernetes Secret of type `kubernetes.io/tls`)
   *
   * _Support: Implementation-specific_ (More than one reference or other resource types)
   */
  certificateRefs?: Input<Array<Input<SecretObjectReference>>>;

  /**
   * Options are a list of key/value pairs to enable extended TLS
   * configuration for each implementation. For example, configuring the
   * minimum TLS version or supported cipher suites.
   *
   * A set of common keys MAY be defined by the API in the future. To avoid
   * any ambiguity, implementation-specific definitions MUST use
   * domain-prefixed names, such as example.com/my-custom-option.
   *
   * Un-prefixed names are reserved for key names defined by Gateway API.
   *
   * _Support: Implementation-specific_
   */
  options?: Input<{
    [key: string]: Input<string>;
  }>;
}
