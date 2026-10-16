import { PolicyPack } from '@pulumi/policy';
import { deploymentPvcNeedsRecreate } from './rules/deploymentPvcStrategy';
import { efsAccessPointScoped } from './rules/efsAccessPointScope';
import { guarddutySingleOwner } from './rules/guardduty';

new PolicyPack('bes-guardrails', {
  policies: [guarddutySingleOwner, deploymentPvcNeedsRecreate, efsAccessPointScoped],
});
