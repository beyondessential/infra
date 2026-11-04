import { type ComponentResourceOptions, type Input, all, output } from '@pulumi/pulumi';
import * as aws from '@pulumi/aws-native';
import { AWS_STS } from '../constants/external.ts';

export interface EksServiceAccountArgs {
  roleName?: Input<string>;
  roleDescription?: Input<string>;
  serviceAccountName: Input<string>;
  oidcProviderArn: Input<string>;
  namespace: Input<string>;
  managedPolicyArns?: Input<Input<string>[]>;
  /**
   * With a wildcard namespace, trust only `serviceAccountName` in the matching
   * namespaces. Without it, a wildcard namespace trusts every service account.
   */
  pinServiceAccount?: boolean;
}

export function eksServiceAccount(
  name: string,
  args: EksServiceAccountArgs,
  opts?: ComponentResourceOptions,
): aws.iam.Role {
  const oidcId = output(args.oidcProviderArn).apply((arn) =>
    arn.substring(arn.indexOf('/oidc.eks.') + 1),
  );

  return new aws.iam.Role(
    name,
    {
      assumeRolePolicyDocument: all([
        oidcId,
        args.oidcProviderArn,
        args.namespace,
        args.serviceAccountName,
      ]).apply(([id, arn, namespace, serviceAccount]) => ({
        Version: '2012-10-17',
        Statement: [
          {
            Effect: 'Allow',
            Principal: {
              Federated: arn,
            },
            Action: 'sts:AssumeRoleWithWebIdentity',
            Condition: namespace.includes('*')
              ? {
                  StringEquals: {
                    [`${id}:aud`]: AWS_STS,
                  },
                  StringLike: {
                    [`${id}:sub`]: `system:serviceaccount:${namespace}:${args.pinServiceAccount ? serviceAccount : '*'}`,
                  },
                }
              : {
                  StringEquals: {
                    [`${id}:aud`]: AWS_STS,
                    [`${id}:sub`]: `system:serviceaccount:${namespace}:${serviceAccount}`,
                  },
                },
          },
        ],
      })),
      managedPolicyArns: args.managedPolicyArns,
    },
    opts,
  );
}
