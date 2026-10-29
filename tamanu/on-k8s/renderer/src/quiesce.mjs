// Stops a server's processes while its migrator applies migrations, and starts
// them again afterwards. Runs in the Tamanu image with `node -e`, so it uses only
// Node built-ins and talks to the Kubernetes API as the pod's service account.
// In quiesce mode it runs after `just-migrate list --check`, which has printed
// the pending migrations to the log above this script's output.
//
// QUIESCE_MODE   `quiesce` or `resume`
// DEPLOYMENTS    comma-separated names of the server's process Deployments
// PENDING        (quiesce) `yes` when migrations are pending, `no` when not
// ANNOTATION     where the replica count to restore is kept
// WAIT_SECONDS   (quiesce) how long to wait for the processes' pods to go

import { readFile } from 'node:fs/promises';
import { setTimeout as sleep } from 'node:timers/promises';

const SA = '/var/run/secrets/kubernetes.io/serviceaccount';
const API = 'https://kubernetes.default.svc';
const { QUIESCE_MODE, DEPLOYMENTS, PENDING, ANNOTATION, WAIT_SECONDS = '900' } = process.env;

const namespace = (await readFile(`${SA}/namespace`, 'utf8')).trim();
const token = (await readFile(`${SA}/token`, 'utf8')).trim();
const deployments = DEPLOYMENTS.split(',').filter(Boolean);

async function request(method, path, body) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: {
      authorization: `Bearer ${token}`,
      ...(body ? { 'content-type': 'application/merge-patch+json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (method === 'GET' && res.status === 404) return null;
  if (!res.ok) throw new Error(`${method} ${path}: ${res.status} ${await res.text()}`);
  return res.json();
}

const deploymentPath = name => `/apis/apps/v1/namespaces/${namespace}/deployments/${name}`;
const scale = (name, replicas) =>
  request('PATCH', `${deploymentPath(name)}/scale`, { spec: { replicas } });
const annotate = (name, value) =>
  request('PATCH', deploymentPath(name), { metadata: { annotations: { [ANNOTATION]: value } } });

async function podsOf(deployment) {
  const selector = Object.entries(deployment.spec.selector.matchLabels ?? {})
    .map(([key, value]) => `${key}=${value}`)
    .join(',');
  const pods = await request(
    'GET',
    `/api/v1/namespaces/${namespace}/pods?labelSelector=${encodeURIComponent(selector)}`,
  );
  return pods.items.map(pod => pod.metadata.name);
}

async function quiesce() {
  // Anything but a clear `no` stops the servers: running them against a
  // database mid-migration is the failure this guards against.
  if (PENDING === 'no') {
    console.log('No migrations pending, leaving the servers running');
    return;
  }
  console.log('Migrations pending, stopping the servers');

  const stopping = [];
  for (const name of deployments) {
    const deployment = await request('GET', deploymentPath(name));
    if (!deployment) continue;
    // A retry after a failed migration finds the annotation already set and
    // keeps it, so the count restored is the one from before the first attempt.
    if (deployment.metadata.annotations?.[ANNOTATION] === undefined) {
      await annotate(name, String(deployment.spec.replicas ?? 1));
    }
    await scale(name, 0);
    console.log(`Scaled ${name} to 0`);
    stopping.push(deployment);
  }

  const deadline = Date.now() + Number(WAIT_SECONDS) * 1000;
  for (;;) {
    const remaining = (await Promise.all(stopping.map(podsOf))).flat();
    if (remaining.length === 0) break;
    if (Date.now() > deadline) {
      throw new Error(`Pods still running after ${WAIT_SECONDS}s: ${remaining.join(', ')}`);
    }
    console.log(`Waiting for ${remaining.length} pods to stop: ${remaining.join(', ')}`);
    await sleep(5000);
  }
  console.log('Servers stopped');
}

async function resume() {
  for (const name of deployments) {
    const deployment = await request('GET', deploymentPath(name));
    const recorded = deployment?.metadata.annotations?.[ANNOTATION];
    if (recorded === undefined) continue;
    const replicas = Number.parseInt(recorded, 10);
    if (!Number.isInteger(replicas) || replicas < 0) {
      throw new Error(`${name}: ${ANNOTATION} is not a replica count: ${recorded}`);
    }
    await scale(name, replicas);
    await annotate(name, null);
    console.log(`Scaled ${name} back to ${replicas}`);
  }
}

if (QUIESCE_MODE === 'quiesce') await quiesce();
else if (QUIESCE_MODE === 'resume') await resume();
else throw new Error(`Unknown QUIESCE_MODE: ${QUIESCE_MODE}`);
