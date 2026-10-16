import { LOGS_BUCKETS } from '../../constants/internal.ts';

export const BUCKET = 'bes-data-docs';
export const DOMAIN = 'docs.data.bes.au';
export const ZONE_ID = 'Z07801321MEVDI0D1XE18';
export const LOGS_BUCKET = LOGS_BUCKETS.DATA;
export const DB_SECRET_ARNS = [
  'arn:aws:secretsmanager:ap-southeast-2:491618206332:secret:oldaws/tamanu-replicas/postgres-7J2wpE',
  'arn:aws:secretsmanager:ap-southeast-2:491618206332:secret:oldaws/data-lake/postgres-Qn7lFr',
  // PGRO-managed per-country replicas (nauru, palau, …); wildcard covers future ones
  'arn:aws:secretsmanager:ap-southeast-2:491618206332:secret:infra-replica-*/postgres-*',
];
