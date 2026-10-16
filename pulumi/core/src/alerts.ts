import * as aws from '@pulumi/aws';
import { getStack } from '@pulumi/pulumi';

export const topic = new aws.sns.Topic('workload-alerts', {
  displayName: `[${getStack()}] Workload Alerts`,
});

export const alertsTopicArn = topic.arn;

new aws.sns.TopicSubscription(
  'send-to-devlead',
  {
    topic: topic.arn,
    protocol: 'email',
    endpoint: 'felix+aws-alerts@bes.au',
  },
  { parent: topic },
);

new aws.cloudwatch.MetricAlarm('overall-high-cpu', {
  name: 'OverallHighCPU',
  alarmDescription: `[${getStack()}] When any EC2 instance exceeds 80% CPU utilization for more than 4 hours`,
  namespace: 'AWS/EC2',
  metricName: 'CPUUtilization',
  statistic: 'Maximum',
  threshold: 80,
  evaluationPeriods: 2,
  period: 60 * 60 * 2,
  comparisonOperator: 'GreaterThanOrEqualToThreshold',
  alarmActions: [topic],
});

new aws.cloudwatch.MetricAlarm('cpu-credits-charged', {
  name: 'CPUCreditsCharged',
  alarmDescription: `[${getStack()}] When any T-family instance exceeds its burst credit for more than an account-wide-cumulative 60 cpu-minutes per day`,
  namespace: 'AWS/EC2',
  metricName: 'CPUSurplusCreditsCharged',
  statistic: 'Sum',
  threshold: 60, // cpu-minutes
  evaluationPeriods: 2,
  period: 300,
  comparisonOperator: 'GreaterThanOrEqualToThreshold',
  alarmActions: [topic],
});
