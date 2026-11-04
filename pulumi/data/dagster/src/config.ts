import { getStack } from '@pulumi/pulumi';
import { CrossStack } from '../../../common/CrossStack.ts';
import { cfg } from '../../../common/k8s/coreRef.ts';

export const normalizedStack = getStack()
  .toLowerCase()
  .replace(/[^a-z0-9-]+/g, '-')
  .replace(/-+$/, '')
  .slice(0, 63 - 'dagster-'.length) // 63 is the max length of a k8s namespace, minus the prefix
  .replace(/^-+|-+$/g, '');

// spec: DAGS#instance
export const name = ['dagster', cfg.get('namespace') ?? normalizedStack].join('-');

// Tracks the dagster version that data-lake's uv.lock resolves to; the chart's
// version is the application version.
export const dagsterChartVersion = cfg.get('dagsterChartVersion') ?? '1.13.26';

export const imageRepository = 'ghcr.io/beyondessential/data-lake-dagster';
export const imageTag = cfg.require('imageTag');
// Only needed while the image is private.
export const imagePullPat = cfg.getSecret('imagePullPat');

// The AWS side lives in the dagster-infra project, applied separately with AWS
// credentials, so this stack needs only a tailnet identity.
const infra = new CrossStack(cfg.require('infraStack'));
export const roleArn = infra.get<string>('dagsterRoleArn');
export const computeLogsBucket = infra.get<string>('computeLogsBucket');
export const dbIamAuth = await infra.getValue<boolean>('dbIamAuth');
export const awsRegion = infra.get<string>('region');

// The data-warehouse database, as `postgres://user[:password]@host[:port]/database`.
// The host is the in-cluster k8s-db-proxy Service (`<hostname>.<namespace>.svc.cluster.local`)
// rather than the RDS endpoint. The password is present exactly when IAM
// database authentication is off.
function parseDbUrl(raw: string) {
  const url = new URL(raw);
  const user = decodeURIComponent(url.username);
  const database = decodeURIComponent(url.pathname.replace(/^\//, ''));
  if (!['postgres:', 'postgresql:'].includes(url.protocol) || !url.hostname || !user || !database) {
    throw new Error('dbUrl must be postgres://user[:password]@host[:port]/database');
  }
  const password = url.password ? decodeURIComponent(url.password) : undefined;
  if (dbIamAuth && password) {
    throw new Error('dbUrl must not carry a password when IAM database authentication is on');
  }
  if (!dbIamAuth && !password) {
    throw new Error('dbUrl must carry a password unless IAM database authentication is on');
  }
  return { host: url.hostname, port: url.port ? Number(url.port) : 5432, user, database, password };
}
const db = cfg.requireSecret('dbUrl').apply(parseDbUrl);
export const dbHost = db.host;
export const dbPort = db.port;
export const dbUser = db.user;
export const dbDatabase = db.database;
export const dbPassword = db.password;

// Every other environment variable the code locations read, as one KEY=VALUE per
// line like a .env file. The list belongs to data-lake and changes without this
// stack, so the keys are not named here individually.
export const appEnvBlob = cfg.requireSecret('appEnvBlob');

// Each entry names the Python file or package to load, resolved from the image's
// working directory. The name of the code server is derived from it.
export interface CodeLocationConfig {
  file?: string;
  package?: string;
  memoryRequest?: string;
}
export const codeLocations = cfg.requireObject<CodeLocationConfig[]>('codeLocations');

export const cpuRequest = cfg.get('cpuRequest') ?? '100m';
export const memoryRequest = cfg.get('memoryRequest') ?? '512Mi';
export const runPodCpuRequest = cfg.get('runPodCpuRequest') ?? '250m';
export const runPodMemoryRequest = cfg.get('runPodMemoryRequest') ?? '1Gi';
