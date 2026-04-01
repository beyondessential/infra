import type { Input } from '@pulumi/pulumi';

/**
 * Configures if requests to the authorization server should include
 * the body of the client request; and if so, how big that body is
 * allowed to be.
 *
 * If empty or unset, do not forward the body.
 */
export interface ForwardBodyConfig {
  /**
   * MaxSize specifies how large in bytes the largest body that will be buffered
   * and sent to the authorization server. If the body size is larger than
   * maxSize, then the body sent to the authorization server must be
   * truncated to maxSize bytes.
   *
   * Experimental note: This behavior needs to be checked against
   * various dataplanes; it may need to be changed.
   *
   * See <https://github.com/kubernetes-sigs/gateway-api/pull/4001#discussion_r2291405746>
   * for more.
   *
   * If `0`, the body will not be sent to the authorization server.
   */
  maxSize: Input<number>;
}
