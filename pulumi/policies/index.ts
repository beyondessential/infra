import { PolicyPack } from '@pulumi/policy';
import { deploymentPvcNeedsRecreate } from './rules/deploymentPvcStrategy';
import { guarddutySingleOwner } from './rules/guardduty';

new PolicyPack('bes-guardrails', {
  policies: [guarddutySingleOwner, deploymentPvcNeedsRecreate],
});
