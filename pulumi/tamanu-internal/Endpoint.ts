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
  domain?: string;
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
    { clusterName, certificateArn, infra, domain, port = DEFAULT_PORT, tags = {} }: EndpointArgs,
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

    // Pulumi doesn't handle name length for us here, so we need to always generate unique names
    // shorter than 32 characters, minus the 8 characters Pulumi adds to the end, minus some extra
    // just in case. We use the names we have as input, but hash the lot to make a shorter uniquestr
    // deterministically. Fortunately TargetGroups don't really need to have a recognisable name.
    const hashedName = createHash('sha256')
      .update(clusterName)
      .update(this.#name)
      .digest('base64url')
      .replace(/[^a-zA-Z0-9]+/g, '')
      .substring(0, 20);

    this.targetGroup = new TargetGroup(
      hashedName,
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
        name: zoneName.apply((zone) => `${domain ?? this.#name}.${clusterName}.${zone}`),
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
