import type { Input } from '@pulumi/pulumi';

export interface Fraction {
  /** Integer. Minimum 0. */
  numerator: Input<number>;

  /** Integer. Minimum 1. Defaults to `100`. */
  denominator?: Input<number>;
}
