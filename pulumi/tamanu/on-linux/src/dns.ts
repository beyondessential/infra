import * as aws from '@pulumi/aws';
import { zoneId } from './config.ts';
// import { all, output } from '@pulumi/pulumi';

// to do imports of existing Route53 records, uncomment
// commented out lines, run once, then re-comment them

export function applyDNS(records: Map<string, Omit<aws.route53.RecordArgs, 'zoneId'>>) {
  for (const [name, record] of records) {
    // all([zoneId, output(record.name), output(record.type)]).apply(([zone, fqdn, type]) => {
    // spec: LNXSRV#dns-records
    new aws.route53.Record(
      name,
      {
        zoneId,
        ...record,
      },
      // { import: `${zone}_${fqdn}_${type}` },
    );
    // });
  }
}
