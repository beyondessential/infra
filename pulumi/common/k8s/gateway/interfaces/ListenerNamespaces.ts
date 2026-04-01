import type { Input } from '@pulumi/pulumi';
import type * as k8s from '@pulumi/kubernetes';
import type { FromNamespaces } from '../consts/FromNamespaces.ts';

/**
 * ListenerNamespaces indicate which namespaces ListenerSets should be selected from.
 */
export interface ListenerNamespaces {
  /**
   * From indicates where ListenerSets can attach to this Gateway.
   *
   * Possible values are:
   * - `Same`: Only ListenerSets in the same namespace may be attached to this Gateway.
   * - `Selector`: ListenerSets in namespaces selected by the selector may be attached to this Gateway.
   * - `All`: ListenerSets in all namespaces may be attached to this Gateway.
   * - `None`: Only listeners defined in the Gateway's spec are allowed.
   *
   * The default value `None`.
   */
  from?: Input<FromNamespaces>;

  /**
   * Selector must be specified when `from` is set to `Selector`. In that case,
   * only ListenerSets in Namespaces matching this Selector will be selected by this
   * Gateway. This field is ignored for other values of `from`.
   */
  selector?: Input<k8s.types.input.meta.v1.LabelSelector>;
}
