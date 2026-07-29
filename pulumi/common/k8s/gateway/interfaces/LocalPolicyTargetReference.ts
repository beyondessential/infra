import type { Input } from '@pulumi/pulumi';

/**
 * Identifies an API object to apply a policy to, within the same namespace as
 * the policy.
 */
export interface LocalPolicyTargetReference {
  /** Group of the target resource. */
  group: Input<string>;

  /** Kind of the target resource. */
  kind: Input<string>;

  /** Name of the target resource. */
  name: Input<string>;

  /**
   * SectionName targets a specific part of the resource, such as one named
   * listener on a Gateway. Only set this when the policy genuinely needs to
   * apply to a section rather than the whole resource.
   */
  sectionName?: Input<string>;
}
