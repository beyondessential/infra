import { createHash } from 'crypto';
import {
  ComponentResource,
  ComponentResourceOptions,
  Input,
  Output,
  StackReference,
  all,
} from '@pulumi/pulumi';
import { Service } from '@pulumi/aws/servicediscovery/index.js';
import { ListenerCertificate, ListenerRule, TargetGroup } from '@pulumi/aws/lb/index.js';
import { Record } from '@pulumi/aws/route53/index.js';
import { ValidCertificate } from '../../common/ValidCertificate.js';

export const DEFAULT_PORT = 3000;

export interface EndpointArgs {
  clusterName: string;
  infra: StackReference;
  superdomain?: string;
  domain?: string;
  port?: number;
  certificateArn?: Input<string>;

  lb?:
    | {
        listener: Input<string>;
        dnsName: Input<string>;
      }
    | false;

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
    {
      clusterName,
      certificateArn,
      infra,
      domain,
      superdomain,
      port = DEFAULT_PORT,
      lb,
      tags = {},
    }: EndpointArgs,
    opts: ComponentResourceOptions = {},
  ) {
    super('bes:tamanu:Endpoint', name, {}, opts);
    this.#name = name;
    this.#infra = infra;
    this.port = port;

    const $cluster = this.#infra.getOutput('cluster');
    const $network = this.#infra.getOutput('network');

    const namespace = $cluster.apply((cluster) => cluster.containers.namespaceName as string);
    const namespaceId = $cluster.apply((cluster) => cluster.containers.namespaceId as string);

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

    const vpcId = $network.apply((network) => network.vpc as string);

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

    if (!lb) {
      lb = {
        listener: $cluster.apply((cluster) => cluster.lb.listener as string),
        dnsName: $cluster.apply((cluster) => cluster.lb.dnsName as string),
      };
    }

    const zoneId = $cluster.apply((cluster) => cluster.zone.id as string);
    const zoneName = $cluster.apply((cluster) => cluster.zone.name as string);

    const endpoint = new Record(
      `${clusterName}-${this.#name}`,
      {
        zoneId,
        name: zoneName.apply(
          (zone) => `${domain ?? this.#name}.${superdomain ?? clusterName}.${zone}`,
        ),
        type: 'CNAME',
        ttl: 300,
        records: [lb.dnsName],
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
        listenerArn: lb.listener,
        certificateArn,
      },
      { parent: endpoint },
    );

    new ListenerRule(
      `${clusterName}-${this.#name}`,
      {
        listenerArn: lb.listener,
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
