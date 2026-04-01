import type { Input } from '@pulumi/pulumi';
import type * as k8s from '@pulumi/kubernetes';
import type { FromNamespaces } from '../consts/FromNamespaces.ts';

/**
 * RouteNamespaces indicate which namespaces Routes should be selected from.
 */
export interface RouteNamespaces {
  /**
   * From indicates where Routes will be selected for this Gateway.
   *
   * Defaults to `Same`. Possible values are:
   * - `All`: Routes in all namespaces may be used by this Gateway.
   * - `Selector`: Routes in namespaces selected by the selector may be used by
   *   this Gateway.
   * - `Same`: Only Routes in the same namespace may be used by this Gateway.
   *
   * _Support: Core_
   */
  from?: Input<FromNamespaces>;

  /**
   * Selector must be specified when `from` is set to `Selector`.
   *
   * In that case, only Routes in Namespaces matching this Selector
   * will be selected by this Gateway. This field is ignored for other
   * values of `from`.
   *
   * _Support: Core_
   */
  selector?: Input<k8s.types.input.meta.v1.LabelSelector>;
}
