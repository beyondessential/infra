import * as k8s from '@pulumi/kubernetes';
import { jsonStringify, type Output } from '@pulumi/pulumi';
import { namespace } from './namespace.ts';
import { appEnvBlob, imagePullPat } from './config.ts';

// `appEnvBlob` is one KEY=VALUE per line, same shape as a .env file — see the
// comment on it in config.ts for why this is a blob rather than individual
// named config values. Blank lines and '#'-comments are skipped; anything
// else without an '=' is a config error worth failing loudly on, rather than
// silently dropping a malformed line and finding out only when a code
// location fails to parse at runtime.
function parseDotenv(blob: string): Record<string, string> {
	const result: Record<string, string> = {};
	for (const rawLine of blob.split('\n')) {
		const line = rawLine.trim();
		if (line === '' || line.startsWith('#')) {
			continue;
		}
		const eq = line.indexOf('=');
		if (eq === -1) {
			throw new Error(`appEnvBlob: line has no '=': ${JSON.stringify(line)}`);
		}
		result[line.slice(0, eq).trim()] = line.slice(eq + 1).trim();
	}
	return result;
}

export const envSecretName = 'dagster-env';

// Only the code locations' own env vars — not Dagster's storage DB creds or
// compute-log bucket name. Those go straight into the Helm chart's own
// `values.postgresql.*` / `computeLogManager.*` (helm.ts), which bakes them
// into the instance config the chart generates internally; no data-lake code
// reads DAGSTER_DB_* or DAGSTER_COMPUTE_LOG_BUCKET as an env var (checked —
// those names only ever appeared in data-lake's own devops/k8s/dagster.yaml,
// a reference file nothing reads yet, not the actual Helm-deployed config).
// Keeping them out of this Secret also means the DB password — in password
// mode — exists in exactly one place, not duplicated into a second Secret.
export const envSecret: Output<k8s.core.v1.Secret> = appEnvBlob.apply(
	(blob) =>
		new k8s.core.v1.Secret('dagster-env', {
			metadata: { name: envSecretName, namespace },
			stringData: parseDotenv(blob),
		}),
);

export const registrySecretName = 'dagster-registry';

// Optional: see config.ts's own comment on imagePullPat. undefined when the
// image turns out to be publicly pullable, in which case no pull secret (and
// no imagePullSecrets reference) is created at all.
export const registrySecret = imagePullPat
	? new k8s.core.v1.Secret('dagster-registry', {
			metadata: { name: registrySecretName, namespace },
			type: 'kubernetes.io/dockerconfigjson',
			stringData: {
				'.dockerconfigjson': jsonStringify({
					auths: {
						'https://ghcr.io': {
							auth: imagePullPat.apply((pat) =>
								Buffer.from(`beyondessential:${pat}`).toString('base64'),
							),
						},
					},
				}),
			},
		})
	: undefined;
