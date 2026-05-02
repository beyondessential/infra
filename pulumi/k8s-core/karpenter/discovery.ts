import * as awsClassic from '@pulumi/aws';
import { $network } from '../../common/coreRef.ts';
import { cluster, clusterName } from '../cluster.ts';

// k[placement.cluster-scoped-discovery]
// Tag subnets and the cluster security group with `karpenter.sh/discovery=<clusterName>`
// so Karpenter selects only this cluster's networking resources. Subnet `Purpose`
// tags (`nat`/`workload`) remain unchanged for billing.

$network.natSubnetIds.apply((ids) =>
  ids.forEach((id, i) => {
    new awsClassic.ec2.Tag(`karpenter-discovery-nat-${i}`, {
      resourceId: id,
      key: 'karpenter.sh/discovery',
      value: clusterName,
    });
  }),
);

$network.workloadSubnetIds.apply((ids) =>
  ids.forEach((id, i) => {
    new awsClassic.ec2.Tag(`karpenter-discovery-workload-${i}`, {
      resourceId: id,
      key: 'karpenter.sh/discovery',
      value: clusterName,
    });
  }),
);

new awsClassic.ec2.Tag('karpenter-cluster-sg-discovery', {
  resourceId: cluster.clusterSecurityGroupId,
  key: 'karpenter.sh/discovery',
  value: clusterName,
});
