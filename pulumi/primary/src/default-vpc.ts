import { asset, jsonStringify } from '@pulumi/pulumi';
import * as aws from '@pulumi/aws';
import { AWS_ROOT_ID, AWS_TUPAIA_ACCOUNT_ID } from '../../constants/internal.ts';
import { region } from '../../common/awsAccount.ts';

const tags = { ManagedBy: 'pulumi', Purpose: 'default-vpc-governance' };

// ---------------------------------------------------------------------------
// SCP: deny (re)creation of default VPCs org-wide, except in the Tupaia account.
// Applies to member accounts only (the management account is never subject to
// SCPs). This stops anything from recreating a default VPC after cleanup.
// ---------------------------------------------------------------------------
const denyDefaultVpc = new aws.organizations.Policy('deny-default-vpc-creation', {
  name: 'deny-default-vpc-creation',
  type: 'SERVICE_CONTROL_POLICY',
  description: 'Deny creation of default VPCs/subnets in all accounts except Tupaia',
  content: jsonStringify({
    Version: '2012-10-17',
    Statement: [
      {
        Sid: 'DenyCreateDefaultVpc',
        Effect: 'Deny',
        Action: ['ec2:CreateDefaultVpc', 'ec2:CreateDefaultSubnet'],
        Resource: '*',
        Condition: {
          StringNotEquals: { 'aws:PrincipalAccount': AWS_TUPAIA_ACCOUNT_ID },
        },
      },
    ],
  }),
  tags,
});

new aws.organizations.PolicyAttachment('deny-default-vpc-creation-root', {
  policyId: denyDefaultVpc.id,
  targetId: AWS_ROOT_ID,
});

// ---------------------------------------------------------------------------
// StackSet: in every member account, delete the default VPC in each region —
// but ONLY when it is empty (no ENIs). In-use default VPCs are left untouched,
// so accounts that still rely on theirs (intentionally or accidentally) keep
// working until their workloads migrate to `core`. Auto-deploys to new accounts.
// ---------------------------------------------------------------------------

// Inline Lambda. boto3 + cfnresponse-style PUT to the response URL. All-or-
// nothing per region: it checks for ENIs first and skips the whole region if
// anything is present, so it can never half-dismantle a VPC in use.
const cleanupCode = `
import json, boto3, urllib.request
from botocore.exceptions import ClientError

def send(event, context, status, data, reason=None):
    body = json.dumps({
        'Status': status,
        'Reason': reason or ('See log stream: ' + context.log_stream_name),
        'PhysicalResourceId': event.get('PhysicalResourceId') or context.log_stream_name,
        'StackId': event['StackId'],
        'RequestId': event['RequestId'],
        'LogicalResourceId': event['LogicalResourceId'],
        'Data': data,
    }).encode()
    req = urllib.request.Request(event['ResponseURL'], data=body, method='PUT',
                                 headers={'content-type': '', 'content-length': str(len(body))})
    urllib.request.urlopen(req)

def sweep_region(ec2):
    vpcs = ec2.describe_vpcs(Filters=[{'Name': 'isDefault', 'Values': ['true']}])['Vpcs']
    if not vpcs:
        return 'absent'
    vpc_id = vpcs[0]['VpcId']
    enis = ec2.describe_network_interfaces(
        Filters=[{'Name': 'vpc-id', 'Values': [vpc_id]}])['NetworkInterfaces']
    if enis:
        return 'in-use (%d ENIs) %s' % (len(enis), vpc_id)
    for sn in ec2.describe_subnets(Filters=[{'Name': 'vpc-id', 'Values': [vpc_id]}])['Subnets']:
        ec2.delete_subnet(SubnetId=sn['SubnetId'])
    for igw in ec2.describe_internet_gateways(
            Filters=[{'Name': 'attachment.vpc-id', 'Values': [vpc_id]}])['InternetGateways']:
        ec2.detach_internet_gateway(InternetGatewayId=igw['InternetGatewayId'], VpcId=vpc_id)
        ec2.delete_internet_gateway(InternetGatewayId=igw['InternetGatewayId'])
    for rt in ec2.describe_route_tables(
            Filters=[{'Name': 'vpc-id', 'Values': [vpc_id]}])['RouteTables']:
        if any(a.get('Main') for a in rt.get('Associations', [])):
            continue
        ec2.delete_route_table(RouteTableId=rt['RouteTableId'])
    ec2.delete_vpc(VpcId=vpc_id)
    return 'deleted ' + vpc_id

def sweep_all():
    results, errors = {}, []
    for r in [x['RegionName'] for x in boto3.client('ec2').describe_regions()['Regions']]:
        try:
            results[r] = sweep_region(boto3.client('ec2', region_name=r))
        except ClientError as e:
            code = e.response['Error']['Code']
            if code.startswith('DependencyViolation'):
                results[r] = 'in-use (dependency)'
            else:
                results[r] = 'error: ' + code
                errors.append(r + ': ' + code)
    print(json.dumps(results))
    return results, errors

def handler(event, context):
    # EventBridge scheduled invocation has no 'RequestType': just sweep.
    if 'RequestType' not in event:
        sweep_all()
        return
    # CloudFormation custom-resource lifecycle.
    if event['RequestType'] == 'Delete':
        send(event, context, 'SUCCESS', {})
        return
    try:
        results, errors = sweep_all()
        if errors:
            send(event, context, 'FAILED', results, reason='; '.join(errors)[:1000])
        else:
            send(event, context, 'SUCCESS', results)
    except Exception as e:
        print('fatal', repr(e))
        send(event, context, 'FAILED', {}, reason=str(e)[:1000])
`;

const cleanupTemplate = jsonStringify({
  AWSTemplateFormatVersion: '2010-09-09',
  Description: 'Deletes empty default VPCs in every region; leaves in-use ones untouched',
  Resources: {
    DefaultVpcCleanupRole: {
      Type: 'AWS::IAM::Role',
      Properties: {
        AssumeRolePolicyDocument: {
          Version: '2012-10-17',
          Statement: [
            {
              Effect: 'Allow',
              Principal: { Service: 'lambda.amazonaws.com' },
              Action: 'sts:AssumeRole',
            },
          ],
        },
        Policies: [
          {
            PolicyName: 'default-vpc-cleanup',
            PolicyDocument: {
              Version: '2012-10-17',
              Statement: [
                {
                  Effect: 'Allow',
                  Action: [
                    'ec2:DescribeRegions',
                    'ec2:DescribeVpcs',
                    'ec2:DescribeNetworkInterfaces',
                    'ec2:DescribeSubnets',
                    'ec2:DescribeInternetGateways',
                    'ec2:DescribeRouteTables',
                    'ec2:DeleteSubnet',
                    'ec2:DetachInternetGateway',
                    'ec2:DeleteInternetGateway',
                    'ec2:DeleteRouteTable',
                    'ec2:DeleteVpc',
                  ],
                  Resource: '*',
                },
                {
                  Effect: 'Allow',
                  Action: ['logs:CreateLogGroup', 'logs:CreateLogStream', 'logs:PutLogEvents'],
                  Resource: 'arn:aws:logs:*:*:*',
                },
              ],
            },
          },
        ],
      },
    },
    DefaultVpcCleanupFn: {
      Type: 'AWS::Lambda::Function',
      Properties: {
        Runtime: 'python3.12',
        Handler: 'index.handler',
        Timeout: 300,
        MemorySize: 256,
        Role: { 'Fn::GetAtt': ['DefaultVpcCleanupRole', 'Arn'] },
        Code: { ZipFile: cleanupCode },
      },
    },
    DefaultVpcCleanup: {
      Type: 'Custom::DeleteDefaultVpc',
      Properties: {
        ServiceToken: { 'Fn::GetAtt': ['DefaultVpcCleanupFn', 'Arn'] },
        // bump this to re-run the sweep on the next StackSet update
        Trigger: '1',
      },
    },
    // Re-sweep on a schedule so accounts that empty their default VPC after
    // migrating to core get cleaned up without a StackSet update.
    DefaultVpcCleanupSchedule: {
      Type: 'AWS::Events::Rule',
      Properties: {
        Description: 'Periodically delete newly-emptied default VPCs',
        ScheduleExpression: 'rate(1 day)',
        State: 'ENABLED',
        Targets: [
          { Arn: { 'Fn::GetAtt': ['DefaultVpcCleanupFn', 'Arn'] }, Id: 'DefaultVpcCleanupFn' },
        ],
      },
    },
    DefaultVpcCleanupSchedulePermission: {
      Type: 'AWS::Lambda::Permission',
      Properties: {
        FunctionName: { 'Fn::GetAtt': ['DefaultVpcCleanupFn', 'Arn'] },
        Action: 'lambda:InvokeFunction',
        Principal: 'events.amazonaws.com',
        SourceArn: { 'Fn::GetAtt': ['DefaultVpcCleanupSchedule', 'Arn'] },
      },
    },
  },
});

const cleanupStackSet = new aws.cloudformation.StackSet('default-vpc-cleanup', {
  description: 'Deletes empty default VPCs across all member accounts and regions',
  templateBody: cleanupTemplate,
  permissionModel: 'SERVICE_MANAGED',
  autoDeployment: {
    enabled: true,
    retainStacksOnAccountRemoval: false,
  },
  capabilities: ['CAPABILITY_IAM'],
  operationPreferences: {
    maxConcurrentCount: 10,
    failureToleranceCount: 5,
  },
  callAs: 'SELF',
});

// Single regional instance per account; the Lambda itself sweeps all regions.
// DIFFERENCE filter exempts Tupaia from even being targeted.
new aws.cloudformation.StackSetInstance(
  'default-vpc-cleanup-org',
  {
    stackSetName: cleanupStackSet.name,
    deploymentTargets: {
      organizationalUnitIds: [AWS_ROOT_ID],
      accounts: [AWS_TUPAIA_ACCOUNT_ID],
      accountFilterType: 'DIFFERENCE',
    },
    stackSetInstanceRegion: region,
    operationPreferences: {
      maxConcurrentCount: 10,
      failureToleranceCount: 5,
    },
    callAs: 'SELF',
  },
  { dependsOn: [cleanupStackSet] },
);

// ---------------------------------------------------------------------------
// The management account is exempt from service-managed StackSets and SCPs, so
// the above never reaches it. Run the same empty-only sweep natively here to
// remove this account's own default VPCs (the easiest accidental-launch
// surface), and keep them gone with a daily schedule.
// ---------------------------------------------------------------------------
const primaryCleanupRole = new aws.iam.Role('primary-default-vpc-cleanup', {
  assumeRolePolicy: aws.iam.assumeRolePolicyForPrincipal({ Service: 'lambda.amazonaws.com' }),
  tags,
});

new aws.iam.RolePolicy('primary-default-vpc-cleanup', {
  role: primaryCleanupRole.id,
  policy: jsonStringify({
    Version: '2012-10-17',
    Statement: [
      {
        Effect: 'Allow',
        Action: [
          'ec2:DescribeRegions',
          'ec2:DescribeVpcs',
          'ec2:DescribeNetworkInterfaces',
          'ec2:DescribeSubnets',
          'ec2:DescribeInternetGateways',
          'ec2:DescribeRouteTables',
          'ec2:DeleteSubnet',
          'ec2:DetachInternetGateway',
          'ec2:DeleteInternetGateway',
          'ec2:DeleteRouteTable',
          'ec2:DeleteVpc',
        ],
        Resource: '*',
      },
      {
        Effect: 'Allow',
        Action: ['logs:CreateLogGroup', 'logs:CreateLogStream', 'logs:PutLogEvents'],
        Resource: 'arn:aws:logs:*:*:*',
      },
    ],
  }),
});

const primaryCleanupFn = new aws.lambda.Function('primary-default-vpc-cleanup', {
  runtime: 'python3.12',
  handler: 'index.handler',
  timeout: 300,
  memorySize: 256,
  role: primaryCleanupRole.arn,
  code: new asset.AssetArchive({ 'index.py': new asset.StringAsset(cleanupCode) }),
  tags,
});

// Sweep once on deploy (no 'RequestType' -> the scheduled code path).
new aws.lambda.Invocation('primary-default-vpc-cleanup', {
  functionName: primaryCleanupFn.name,
  input: jsonStringify({ trigger: '1' }),
});

const primaryCleanupSchedule = new aws.cloudwatch.EventRule('primary-default-vpc-cleanup', {
  description: 'Periodically delete empty default VPCs in the management account',
  scheduleExpression: 'rate(1 day)',
  tags,
});

new aws.cloudwatch.EventTarget('primary-default-vpc-cleanup', {
  rule: primaryCleanupSchedule.name,
  arn: primaryCleanupFn.arn,
});

new aws.lambda.Permission('primary-default-vpc-cleanup-events', {
  action: 'lambda:InvokeFunction',
  function: primaryCleanupFn.name,
  principal: 'events.amazonaws.com',
  sourceArn: primaryCleanupSchedule.arn,
});
