import * as aws from '@pulumi/aws';
import { zoneId } from './config.ts';

export function applyDNS(records: Map<string, Omit<aws.route53.RecordArgs, 'zoneId'>>) {
  for (const [name, record] of records) {
    new aws.route53.Record(name, {
      zoneId,
      ...record,
    });
  }
}
