import type { Input } from '@pulumi/pulumi';
import type { ListenerNamespaces } from './ListenerNamespaces.ts';

/**
 * AllowedListeners defines which ListenerSets can be attached to this Gateway.
 */
export interface AllowedListeners {
  /**
   * Namespaces defines which namespaces ListenerSets can be attached to this Gateway.
   *
   * The default value is to allow no ListenerSets.
   */
  namespaces?: Input<ListenerNamespaces>;
}
