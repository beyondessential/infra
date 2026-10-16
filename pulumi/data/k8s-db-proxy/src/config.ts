import { cfg } from '../../../common/k8s/coreRef.ts';

const rawEndpoint = cfg.require('endpoint');
const [host, portStr] = rawEndpoint.split(':');
if (!host || !portStr) {
  throw new Error(`endpoint must be host:port, got ${rawEndpoint}`);
}
const port = Number(portStr);
if (!Number.isInteger(port) || port < 1 || port > 65535) {
  throw new Error(`endpoint port must be a valid integer, got ${portStr}`);
}

export const endpointHost = host;
export const endpointPort = port;

export const tags = cfg.requireObject<string[]>('tags');

export const hostname = host.split('.')[0];
