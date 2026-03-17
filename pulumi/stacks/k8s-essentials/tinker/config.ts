import { cfg } from '../../common/k8s/coreRef.ts';

const imageTag = cfg.require('tinkerGatewayImageTag');
export const image = `ghcr.io/beyondessential/tinker-gateway:${imageTag}`;

export const gatewayReplicas = cfg.getNumber('tinkerGatewayReplicas') ?? 2;
export const databaseName = cfg.get('tinkerGatewayDatabaseName') ?? 'tinker-gateway-db';
export const tailscaleIngressUrl = cfg.require('tinkerGatewayTailscaleIngressUrl');
