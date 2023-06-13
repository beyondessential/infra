import {
  ComponentResource,
  ComponentResourceOptions,
  Input,
  Output,
  StackReference,
  all,
} from '@pulumi/pulumi';
import { Service } from '@pulumi/aws/servicediscovery';
import { ListenerCertificate, ListenerRule } from '@pulumi/aws/lb';
import { TargetGroup } from '@pulumi/aws/lb';
import { Record } from '@pulumi/aws/route53';
import { ValidCertificate } from '../ValidCertificate';
import { createHash } from 'crypto';

export const DEFAULT_PORT = 3000;

export interface EndpointArgs {
  clusterName: string;
  infra: StackReference;
  port?: number;
  certificateArn?: Input<string>;

  /** Any extra tags to add to all resources. */
  tags?: { [key: string]: string };
}

export class Endpoint extends ComponentResource {
  #name: string;
  #infra: StackReference;

  port: number;
  discovery: Service;
  targetGroup: TargetGroup;

  external: Output<string>;
  internal: Output<string>;

  constructor(
    name: string,
    { clusterName, certificateArn, infra, port = DEFAULT_PORT, tags = {} }: EndpointArgs,
    opts: ComponentResourceOptions = {},
  ) {
    super('bes:tamanu:Endpoint', name, {}, opts);
    this.#name = name;
    this.#infra = infra;
    this.port = port;

    const namespace = this.#infra
      .getOutput('cluster')
      .apply((cluster) => cluster.containers.namespaceName as string);
    const namespaceId = this.#infra
      .getOutput('cluster')
      .apply((cluster) => cluster.containers.namespaceId as string);

    this.discovery = new Service(
      `${clusterName}-${this.#name}`,
      {
        dnsConfig: {
          namespaceId,
          dnsRecords: [
            { ttl: 10, type: 'A' },
            { ttl: 10, type: 'SRV' },
          ],
        },
        healthCheckCustomConfig: {
          failureThreshold: 3,
        },
        tags,
      },
      {
        parent: this,
      },
    );

    const vpcId = this.#infra.getOutput('network').apply((network) => network.vpc as string);
    this.targetGroup = new TargetGroup(
      `${createHash('sha256')
        .update(clusterName)
        .digest('base64url')
        .replace(/[^a-zA-Z0-9]+/g, '')
        .substring(0, 31 - 8 - this.#name.length)}-${this.#name}`,
      {
        targetType: 'ip',
        ipAddressType: 'ipv4',
        port,
        protocol: 'HTTP',
        protocolVersion: 'HTTP1',
        vpcId,
        tags,
      },
      { parent: this },
    );

    const listenerArn = this.#infra
      .getOutput('cluster')
      .apply((cluster) => cluster.lb.listener as string);
    const lbEndpoint = this.#infra
      .getOutput('cluster')
      .apply((cluster) => cluster.lb.dnsName as string);

    const zoneId = this.#infra.getOutput('cluster').apply((cluster) => cluster.zone.id as string);
    const zoneName = this.#infra
      .getOutput('cluster')
      .apply((cluster) => cluster.zone.name as string);

    const endpoint = new Record(
      `${clusterName}-${this.#name}`,
      {
        zoneId,
        name: zoneName.apply((zone) => `${this.#name}.${clusterName}.${zone}`),
        type: 'CNAME',
        ttl: 300,
        records: [lbEndpoint],
      },
      { parent: this },
    );

    if (!certificateArn) {
      ({ certificateArn } = new ValidCertificate(
        `${clusterName}-${this.#name}`,
        {
          domainNames: [endpoint.fqdn],
          zoneId,
          tags,
        },
        { parent: endpoint },
      ));
    }

    new ListenerCertificate(
      `${clusterName}-${this.#name}`,
      {
        listenerArn,
        certificateArn,
      },
      { parent: endpoint },
    );

    new ListenerRule(
      `${clusterName}-${this.#name}`,
      {
        listenerArn,
        actions: [
          {
            type: 'forward',
            targetGroupArn: this.targetGroup.arn,
          },
        ],
        conditions: [
          {
            hostHeader: {
              values: [endpoint.fqdn],
            },
          },
        ],
        tags,
      },
      { parent: endpoint },
    );

    this.external = endpoint.fqdn;
    this.internal = all([this.discovery.name, namespace]).apply(
      ([name, namespace]) => `${name}.${namespace}:${port}`,
    );
    this.registerOutputs({
      external: this.external,
      internal: this.internal,
    });
  }
}
