import { getStack } from '@pulumi/pulumi';
import { cfg } from '../../../common/k8s/coreRef.ts';

export const normalizedStack = getStack()
	.toLowerCase()
	.replace(/[^a-z0-9-]+/g, '-')
	.replace(/-+$/, '')
	.slice(0, 63 - 'dagster-'.length) // 63 is the max length of a k8s namespace, minus the prefix
	.replace(/^-+|-+$/g, '');

export const name = ['dagster', cfg.get('namespace') ?? normalizedStack].join('-');
if (name === 'dagster-system' || name === 'dagster-super') {
	throw new Error(`Namespace name ${name.replace(/^dagster-/, '')} is reserved`);
}

// https://artifacthub.io/packages/helm/dagster/dagster — pinned to the exact
// version data-lake's uv.lock resolves to (dagster==1.13.26), the same way the
// image is built. The chart's own version string tracks the app version 1:1.
// Bump this in step with uv.lock, not independently.
export const dagsterChartVersion = cfg.get('dagsterChartVersion') ?? '1.13.26';

const imageTag = cfg.require('imageTag');
export const image = `ghcr.io/beyondessential/data-lake-dagster:${imageTag}`;
// Unconfirmed as of the image's first builds (#2641-#2644 in data-lake) whether
// this image/package even needs a pull secret — GHCR visibility was flagged
// there as needing confirmation with infra. Kept optional so a public image
// needs no secret at all; required only if it turns out private.
export const imagePullPat = cfg.getSecret('imagePullPat');

// Existing data-warehouse RDS (data-internal account) — not a new database.
// Reached through the in-cluster k8s-db-proxy Service, per the plan: the
// cluster is IPv6-only and RDS resolves dual-stack, which trips the Tailscale
// operator's ingress-rule installer (see data/k8s-db-proxy's own comment).
// `dbHost` here should be that proxy's in-cluster Service DNS name
// (`<hostname>.<namespace>.svc.cluster.local`), not the RDS endpoint directly.
export const dbHost = cfg.require('dbHost');
export const dbPort = cfg.getNumber('dbPort') ?? 5432;
export const dbUser = cfg.require('dbUser');
export const dbPassword = cfg.requireSecret('dbPassword');
export const dbDatabase = cfg.require('dbDatabase');

// Must match the bucket the dagster-irsa project's policy was scoped to exactly
// — that's a separate Pulumi project/stack (deliberately: see its own header
// comment), so there is no automatic check that the two agree.
export const computeLogsBucket = cfg.require('computeLogsBucket');

// Stack reference to the dagster-irsa project (e.g. "bes/dagster-irsa/main").
// That stack is applied by a human with aws-sso, not by this one.
export const irsaStack = cfg.require('irsaStack');

// A single secret blob of every other env var the 14 code locations need —
// Slack, Google/GDrive, Azure, NIWA, flutracking, WHO ICD, UptimeRobot, the
// GitHub App used by the auto-fix sensor, and the country replica / data-
// warehouse DB connections (TAMANU_*, DATA_WAREHOUSE_*, BES_DB_*, TUPAIA_DB_*,
// MSUPPLY_DB_*, …). Deliberately not enumerated one-by-one as individual
// Pulumi config values: that list lives in data-lake's own .env.example and
// changes independently of this stack, so naming each one here would drift
// from it immediately. Mirrors how downloadEnvVars.sh dumps whole Bitwarden
// notes wholesale on the EC2 host today, rather than templating field by field.
// Format: one KEY=VALUE per line, same as a .env file; parsed in secrets.ts.
// Replica DB credentials sync is still an open question on the plan (static
// here for now vs. a future Kyverno sync from the replica namespaces' own
// Secrets) — flagging for Félix rather than deciding it in this draft.
export const appEnvBlob = cfg.requireSecret('appEnvBlob');

export const cpuRequest = cfg.get('cpuRequest') ?? '100m';
export const memoryRequest = cfg.get('memoryRequest') ?? '512Mi';
// The flutracking ILI job is the one `processing_load: heavy` location (see
// devops/k8s/dagster.yaml's tag_concurrency_limits in data-lake) — run pods
// get a separate, larger default so it stops starving everything else, the
// same reasoning the plan's §2 "Run launcher" row gives for per-run pods.
export const runPodCpuRequest = cfg.get('runPodCpuRequest') ?? '250m';
export const runPodMemoryRequest = cfg.get('runPodMemoryRequest') ?? '1Gi';
