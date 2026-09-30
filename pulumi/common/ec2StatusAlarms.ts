import * as aws from '@pulumi/aws';
import type { ComponentResourceOptions, Input } from '@pulumi/pulumi';

import { region } from './awsAccount.ts';

export interface Ec2StatusAlarmArgs {
  instanceId: Input<string>;
  notifyTopicArns: Input<string>[];
  tags?: { [key: string]: Input<string> };
}

// Three CloudWatch alarms per EC2 instance: system status, instance status, and
// the combined overall metric. The system-status alarm also triggers EC2
// auto-recovery so a failed host migrates the instance to healthy hardware.
export function ec2StatusAlarms(
  name: string,
  args: Ec2StatusAlarmArgs,
  opts: ComponentResourceOptions = {},
) {
  const { instanceId, notifyTopicArns, tags } = args;
  const recoverActionArn = `arn:aws:automate:${region}:ec2:recover`;
  const dimensions = { InstanceId: instanceId };

  new aws.cloudwatch.MetricAlarm(
    `${name}-status-system`,
    {
      alarmDescription: `EC2 system status check failed for ${name}`,
      namespace: 'AWS/EC2',
      metricName: 'StatusCheckFailed_System',
      statistic: 'Maximum',
      threshold: 1,
      period: 60,
      evaluationPeriods: 2,
      datapointsToAlarm: 2,
      comparisonOperator: 'GreaterThanOrEqualToThreshold',
      dimensions,
      alarmActions: [recoverActionArn, ...notifyTopicArns],
      tags,
    },
    opts,
  );

  new aws.cloudwatch.MetricAlarm(
    `${name}-status-instance`,
    {
      alarmDescription: `EC2 instance status check failed for ${name}`,
      namespace: 'AWS/EC2',
      metricName: 'StatusCheckFailed_Instance',
      statistic: 'Maximum',
      threshold: 1,
      period: 60,
      evaluationPeriods: 2,
      datapointsToAlarm: 2,
      comparisonOperator: 'GreaterThanOrEqualToThreshold',
      dimensions,
      alarmActions: notifyTopicArns,
      tags,
    },
    opts,
  );

  new aws.cloudwatch.MetricAlarm(
    `${name}-status-overall`,
    {
      alarmDescription: `EC2 overall status check failed for ${name}`,
      namespace: 'AWS/EC2',
      metricName: 'StatusCheckFailed',
      statistic: 'Maximum',
      threshold: 1,
      period: 60,
      evaluationPeriods: 5,
      datapointsToAlarm: 5,
      comparisonOperator: 'GreaterThanOrEqualToThreshold',
      dimensions,
      alarmActions: notifyTopicArns,
      tags,
    },
    opts,
  );
}
