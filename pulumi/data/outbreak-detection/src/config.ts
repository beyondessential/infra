import { cfg } from '../../../common/k8s/coreRef.ts';

// Fixed, not per-stack-name: every deployment (Samoa, Nauru, ...) shares one
// namespace and one service account rather than getting its own, since the
// team is small and per-country isolation is unnecessary overhead here.
export const namespace = 'disease-outbreak-detection';
export const serviceAccountName = 'outbreak-detection';

// The bucket this pipeline's S3-backed DuckDB store reads and writes, created
// by the generic `bucket` stack (run with stack name disease-outbreak-detection,
// so it resolves to bes-data-disease-outbreak-detection) and passed in here
// rather than looked up via a StackReference, matching dagster's s3bucket config.
export const s3bucket = cfg.require('s3bucket');
