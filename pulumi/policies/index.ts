import { PolicyPack } from '@pulumi/policy';
import { deploymentPvcNeedsRecreate } from './rules/deploymentPvcStrategy';
import { deployerBindingsIncludePeople } from './rules/deployerBindings';
import { efsAccessPointScoped } from './rules/efsAccessPointScope';
import { guarddutySingleOwner } from './rules/guardduty';

// spec: GRD#rule-set
new PolicyPack('bes-guardrails', {
  policies: [
    guarddutySingleOwner,
    deploymentPvcNeedsRecreate,
    efsAccessPointScoped,
    deployerBindingsIncludePeople,
  ],
});
