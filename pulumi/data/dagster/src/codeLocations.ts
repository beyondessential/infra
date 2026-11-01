import { image, cpuRequest, memoryRequest } from './config.ts';
import { envSecretName } from './secrets.ts';

// Mirrors dagster/workspace.yaml in data-lake, minus `vesalius` — deliberately
// excluded until #2631 (MAUI-7075) removes it from that file after cutover
// (see the plan's Q2). Keep this list and that file in sync by hand; nothing
// enforces agreement between the two repos.
//
// `python_file` entries use `codeServerArgs: ['--python-file', ...]`;
// `python_package` entries use `--package-name`. Both resolve relative to the
// image's WORKDIR (/app/dagster — see data-lake's Dockerfile), the same cwd
// dagster-load.yml and the EC2 systemd units already run from, for the same
// reason: every location imports as a top-level package relative to dagster/.
interface CodeLocation {
	/** Must be DNS-1035-safe (lowercase alphanumeric + hyphens) — this feeds
	 * k8s resource names, unlike the underscored Python module/package name. */
	readonly name: string;
	readonly args: readonly [string, string];
	/** Locations whose `dbt parse` touches several country targets in one
	 * import (see build_definitions.py) cost more than the rest at startup,
	 * even with manifests baked into the image warming dbt's partial-parse
	 * cache — baking avoids a cold reparse, not the reparse itself. */
	readonly heavier?: boolean;
}

export const CODE_LOCATIONS: readonly CodeLocation[] = [
	{ name: 'global-definitions', args: ['--python-file', 'global_definitions.py'] },
	{ name: 'bes', args: ['--package-name', 'bes'] },
	{ name: 'external-resources', args: ['--package-name', 'external_resources'] },
	{ name: 'flutracking', args: ['--package-name', 'flutracking'] },
	{ name: 'msupply', args: ['--package-name', 'msupply'] },
	{ name: 'nauru', args: ['--package-name', 'nauru'] },
	{ name: 'niwa', args: ['--package-name', 'niwa'] },
	{ name: 'senaite', args: ['--package-name', 'senaite'] },
	{ name: 'tamanu-analytics', args: ['--package-name', 'tamanu_analytics'], heavier: true },
	{ name: 'tamanu-datasets', args: ['--package-name', 'tamanu_datasets'], heavier: true },
	{ name: 'tamanu-meta', args: ['--package-name', 'tamanu_meta'] },
	{ name: 'tupaia', args: ['--package-name', 'tupaia'] },
	{ name: 'uptimerobot', args: ['--package-name', 'uptimerobot'] },
	{ name: 'who-icd', args: ['--package-name', 'who_icd'] },
];

export const userDeploymentsValues = CODE_LOCATIONS.map((loc) => ({
	name: loc.name,
	image: { repository: image.split(':')[0], tag: image.split(':')[1], pullPolicy: 'Always' },
	codeServerArgs: [...loc.args],
	port: 3030,
	envSecrets: [{ name: envSecretName }],
	resources: {
		requests: {
			cpu: cpuRequest,
			memory: loc.heavier ? '1Gi' : memoryRequest,
		},
	},
	// Pull secret is set chart-wide via dagster-user-deployments.imagePullSecrets
	// in helm.ts, not per-deployment here.
}));
