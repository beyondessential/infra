/**
 * FromNamespaces specifies namespace from which
 * Routes/ListenerSets may be attached to a Gateway.
 */
export const FromNamespaces = {
  /**
   * Routes/ListenerSets in all namespaces may be attached to this Gateway.
   */
  All: 'All',

  /**
   * Only Routes/ListenerSets in namespaces selected by the selector
   * may be attached to this Gateway.
   */
  Selector: 'Selector',

  /**
   * Only Routes/ListenerSets in the same namespace as the Gateway may
   * be attached to this Gateway.
   */
  Same: 'Same',

  /**
   * No Routes/ListenerSets may be attached to this Gateway.
   */
  None: 'None',
} as const;
export type FromNamespaces = (typeof FromNamespaces)[keyof typeof FromNamespaces];
