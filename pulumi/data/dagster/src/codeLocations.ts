import { imageRepository, imageTag, cpuRequest, memoryRequest } from './config.ts';
import { envSecretName } from './secrets.ts';

// spec: DAGS#code-locations
interface CodeLocation {
  /** DNS-1035 safe, as it names Kubernetes objects; the Python name may not be. */
  readonly name: string;
  /** `--python-file` or `--package-name`, resolved from the image's working directory. */
  readonly args: readonly [string, string];
  /** Parses dbt projects for several countries at import, so it needs more memory. */
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
  image: { repository: imageRepository, tag: imageTag, pullPolicy: 'Always' },
  codeServerArgs: [...loc.args],
  port: 3030,
  envSecrets: [{ name: envSecretName }],
  resources: {
    requests: {
      cpu: cpuRequest,
      memory: loc.heavier ? '1Gi' : memoryRequest,
    },
  },
}));
