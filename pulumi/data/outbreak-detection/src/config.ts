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

// Credentials for pulling the private ghcr.io/beyondessential/disease-outbreak-detection
// image. Optional so the stack still deploys before these are set; the pull
// secret is then simply not created and pods relying on it stay unschedulable
// until it is. Matches pgro's builderPullUser/builderPullPat.
export const ghcrUser = cfg.get('ghcrUser');
export const ghcrToken = cfg.getSecret('ghcrToken');

// Registry/image path hardcoded, tag required — built and pushed by
// .github/workflows/build-image.yml in disease-outbreak-detection on every
// merge to main.
const imageTag = cfg.require('imageTag');
export const image = `ghcr.io/beyondessential/disease-outbreak-detection:${imageTag}`;

// Every deployment the nightly CronJob runs for. Each one's DB credentials
// (Secret outbreak-detection-<deployment>-db) and pipeline config (ConfigMap
// outbreak-detection-<deployment>-config) are created outside Pulumi, once
// per deployment — they're per-deployment secrets this stack's own config
// shouldn't hold, and the deployment's config.yaml already lives, gitignored,
// in the disease-outbreak-detection repo. Required rather than defaulted, so
// adding a deployment here is a deliberate step, not a silent default.
//
// Add a deployment here only once its historical backfill
// (deploy/k8s/job-backfill.yaml in disease-outbreak-detection) has completed —
// the namespace, service account and pull secret this stack creates are
// prerequisites for that backfill Job too, so running `pulumi up` with this
// list still empty is the right first deploy.
export const deployments = cfg.requireObject<string[]>('deployments');
