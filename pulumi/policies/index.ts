import { PolicyPack } from '@pulumi/policy';
import { deploymentPvcNeedsRecreate } from './rules/deploymentPvcStrategy';
import { efsAccessPointScoped } from './rules/efsAccessPointScope';
import { guarddutySingleOwner } from './rules/guardduty';

// spec: GRD#rule-set
new PolicyPack('bes-guardrails', {
  policies: [guarddutySingleOwner, deploymentPvcNeedsRecreate, efsAccessPointScoped],
});
