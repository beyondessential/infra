import * as awsClassic from '@pulumi/aws';
import { pascalStackName, stackName } from '../../common/coreRef.js';

// https://github.com/kubernetes/autoscaler/blob/master/cluster-autoscaler/cloudprovider/aws/CA_with_AWS_IAM_OIDC.md
export const autoscalerPolicy = new awsClassic.iam.Policy('autoscaler-instance-policy', {
  namePrefix: `EKS${pascalStackName}AutoScalerInstances-`,
  description: `Policy for EKS AutoScaler instances (cluster: ${stackName})`,
  policy: {
    Version: '2012-10-17',
    Statement: [
      {
        Effect: 'Allow',
        Action: [
          'autoscaling:DescribeAutoScalingGroups',
          'autoscaling:DescribeAutoScalingInstances',
          'autoscaling:DescribeLaunchConfigurations',
          'autoscaling:DescribeScalingActivities',
          'ec2:DescribeInstanceTypes',
          'ec2:DescribeLaunchTemplateVersions',
        ],
        Resource: ['*'],
      },
      {
        Effect: 'Allow',
        Action: [
          'autoscaling:SetDesiredCapacity',
          'autoscaling:TerminateInstanceInAutoScalingGroup',
        ],
        Resource: ['*'],
        Condition: {
          StringEquals: {
            'autoscaling:ResourceTag/EKSCluster': stackName,
          },
        },
      },
    ],
  },
});
