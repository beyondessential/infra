// Everything a running deployment needs. Split out of index.ts so a retired
// deployment can skip it wholesale rather than creating servers it no longer has.

import './backup/aws.ts';
import './firewall.ts';
import './instances.ts';

export {
  backupBucket,
  deviceRoleArn,
  maintenanceRoleArn,
  bucketArn,
} from './backup/kopia.ts';
export { acmeDnsUsers } from './acme-dns.ts';
