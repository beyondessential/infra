import {
  ComponentResource,
  ComponentResourceOptions,
  Input,
  Output,
  jsonStringify,
} from '@pulumi/pulumi';
import { FileArchive } from '@pulumi/pulumi/asset';
// this form is required to import lambda as otherwise it creates a circular dependency error
import * as aws from '@pulumi/aws';
import { local } from '@pulumi/command';
import { basename } from 'path';

export interface RustLambdaArgs {
  source: string;
  description?: string;
  timeoutSec?: number;
  environment?: Input<{ [key: string]: Input<string> }>;
  network?: NetworkConfig;
  policies?: InlinePolicy[];
  tags?: { [key: string]: string };
}

export interface InlinePolicy {
  name: string;
  policy: aws.iam.PolicyDocument;
}

export interface NetworkConfig {
  /** VPC for the Lambda function. */
  vpcId?: Input<string>;

  /** List of subnet IDs associated with the Lambda function. */
  subnetIds: Input<Input<string>[]>;

  /** List of security group IDs associated with the Lambda function. */
  securityGroupIds: Input<Input<string>[]>;
}

export class RustLambda extends ComponentResource {
  name: Output<string>;

  constructor(
    name: string,
    { tags = {}, ...args }: RustLambdaArgs,
    opts: ComponentResourceOptions = {},
  ) {
    super('pkg:index:RustLambda', name, {}, opts);

    const role = new aws.iam.Role(
      name,
      {
        assumeRolePolicy: {
          Version: '2012-10-17',
          Statement: [
            {
              Effect: 'Allow',
              Principal: { Service: 'lambda.amazonaws.com' },
              Action: 'sts:AssumeRole',
            },
          ],
        },
        inlinePolicies: [
          {
            name: 'lambda-basic',
            policy: jsonStringify({
              Version: '2012-10-17',
              Statement: [
                // to log to cloudwatch
                {
                  Effect: 'Allow',
                  Action: ['logs:CreateLogGroup', 'logs:CreateLogStream', 'logs:PutLogEvents'],
                  Resource: 'arn:aws:logs:*:*:*',
                },

                // to connect to network
                args.network && {
                  Effect: 'Allow',
                  Action: [
                    'ec2:CreateNetworkInterface',
                    'ec2:DescribeNetworkInterfaces',
                    'ec2:DeleteNetworkInterface',
                  ],
                  Resource: '*', // FIXME: restrict to VPC
                },
              ].filter(Boolean),
            }),
          },
          ...(args.policies?.map(({ name, policy }) => ({ name, policy: jsonStringify(policy) })) ??
            []),
        ],
      },
      { parent: this },
    );

    const build = local.runOutput(
      {
        dir: args.source,
        command: 'cargo lambda build --release --arm64',
        archivePaths: [`target/lambda/${basename(args.source)}/bootstrap`],
      },
      { parent: this },
    );

    const lambda = new aws.lambda.Function(
      name,
      {
        description: args.description,
        code: build.archive,
        runtime: 'provided.al2',
        handler: 'bootstrap',
        architectures: ['arm64'],
        role: role.arn,
        timeout: args.timeoutSec,
        environment: {
          variables: args.environment,
        },
        vpcConfig: args.network,
        tags,
      },
      {
        parent: this,
      },
    );

    this.name = lambda.name;
    this.registerOutputs({
      name: lambda.name,
    });
  }
}
