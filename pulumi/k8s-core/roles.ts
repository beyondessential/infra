import { compact } from 'lodash-es';
import * as awsClassic from '@pulumi/aws';
import { AWS_EC2, AWS_EKS } from '../constants/external.ts';
import { pascalStackName, $core, tags, stackName } from '../common/coreRef.ts';

export const controlPlaneRole = new awsClassic.iam.Role('control-plane', {
  namePrefix: `EKS${pascalStackName}ControlPlane-`,
  description: `Role for EKS control plane (cluster: ${stackName})`,
  assumeRolePolicy: {
    Version: '2012-10-17',
    Statement: [
      {
        Effect: 'Allow',
        Principal: {
          Service: AWS_EKS,
        },
        Action: 'sts:AssumeRole',
      },
    ],
  },
  managedPolicyArns: ['arn:aws:iam::aws:policy/AmazonEKSClusterPolicy'],
  tags,
});

// spec: K8SNOD#spot-capacity
// Account-level prerequisite for spot capacity: CreateFleet cannot launch spot
// instances until this role exists, and the node role is not permitted to
// create it implicitly. Pre-existing roles in older accounts must be imported
// into the stack rather than recreated.
export const spotServiceLinkedRole = new awsClassic.iam.ServiceLinkedRole('spot', {
  awsServiceName: 'spot.amazonaws.com',
  tags,
});

export const nodeRole = new awsClassic.iam.Role('node', {
  namePrefix: `EKS${pascalStackName}Node-`,
  description: `Role for EKS nodes (cluster: ${stackName})`,
  assumeRolePolicy: {
    Version: '2012-10-17',
    Statement: [
      {
        Effect: 'Allow',
        Principal: {
          Service: AWS_EC2,
        },
        Action: 'sts:AssumeRole',
      },
    ],
  },
  managedPolicyArns: compact([
    'arn:aws:iam::aws:policy/AmazonEC2ContainerRegistryReadOnly',
    'arn:aws:iam::aws:policy/AmazonEKSWorkerNodePolicy',
    'arn:aws:iam::aws:policy/AmazonEC2ReadOnlyAccess',
    $core.get('eksCniV6Policy'),
  ]),
  tags,
});
