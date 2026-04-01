import type { Input } from '@pulumi/pulumi';

/**
 * LocalParametersReference identifies an API object containing
 * controller-specific configuration resource within the namespace.
 */
export interface LocalParametersRef {
  /**
   * Group of the referent.
   */
  group: Input<string>;

  /**
   * Kind of the referent.
   */
  kind: Input<string>;

  /**
   * Name of the referent.
   */
  name: Input<string>;
}
