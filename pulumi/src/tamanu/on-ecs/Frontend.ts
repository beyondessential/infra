import { ComponentResource, ComponentResourceOptions, Output, StackReference, all } from '@pulumi/pulumi';
import * as awsx from '@pulumi/awsx';
import * as awsClassic from '@pulumi/aws';
import { cpuArchitecture } from './config.js';

export interface FrontendArgs {
  ecs: awsClassic.ecs.Cluster;
  infra: StackReference;
  repos: StackReference;

  clusterName: string;
  imageName: string;
  imageTag: string;

  /** Any extra tags to add to all resources. */
  tags?: { [key: string]: string };
}

export class Frontend extends ComponentResource {
  #name: string;
  #args: Required<FrontendArgs>;
  #infra: StackReference;
  #repos: StackReference;

  discovery: awsClassic.servicediscovery.Service;
  discoveryDns: Output<string>;

  constructor(args: FrontendArgs, opts: ComponentResourceOptions = {}) {
    super('bes:tamanu:Frontend', 'frontend', {}, opts);
    this.#name = 'frontend';
    this.#args = {
      tags: {},
      ...args,
    };
    this.#infra = args.infra;
    this.#repos = args.repos;

    const { imageName } = this.#args;
    const subnets = this.#infra
      .getOutput('network')
      .apply((network) => network.workloadSubnetIds as string[]);
    const securityGroup = this.#infra
      .getOutput('cluster')
      .apply((cluster) => cluster.containers.securityGroup as string);

    const image = this.#repos
      .getOutput('repos')
      .apply((repos) => `${repos[imageName]}:${this.#args.imageTag}`);

    const $cluster = this.#infra.getOutput('cluster');
    const namespace = $cluster.apply((cluster) => cluster.containers.namespaceName as string);
    const namespaceId = $cluster.apply((cluster) => cluster.containers.namespaceId as string);

    this.discovery = new awsClassic.servicediscovery.Service(
      `${this.#args.clusterName}-${this.#name}`,
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
        tags: this.#args.tags,
      },
      {
        parent: this,
        ignoreChanges: ['healthCheckCustomConfig'],
      },
    );
    this.discoveryDns = all([this.discovery.name, namespace]).apply(
      ([name, namespace]) => `${name}.${namespace}`,
    );

    const task: awsx.ecs.FargateTaskDefinitionArgs = {
      family: `${this.#args.clusterName}-${this.#name}`,
      memory: (0.5 * 1024).toString(),
      cpu: (0.25 * 1024).toString(),
      runtimePlatform: {
        operatingSystemFamily: 'LINUX',
        cpuArchitecture,
      },
      containers: {
        web: {
          name: 'web',
          image,
          essential: true,
          linuxParameters: {
            initProcessEnabled: true,
          },
          portMappings: [
            {
              protocol: 'HTTP',
              containerPort: 3000,
            },
          ],
        },
      },
      logGroup: {
        args: {
          namePrefix: `${this.#args.clusterName}-${this.#name}-frontend-`,
        },
      },
      tags: this.#args.tags,
    };

    new awsx.ecs.FargateService(
      this.#name,
      {
        cluster: this.#args.ecs.arn,
        taskDefinitionArgs: task,
        desiredCount: 1,
        propagateTags: 'SERVICE',
        serviceRegistries: {
          port: 3000,
          registryArn: this.discovery.arn,
        },
        networkConfiguration: {
          subnets,
          securityGroups: [securityGroup],
        },
        continueBeforeSteadyState: true,
        tags: this.#args.tags,
      },
      { parent: this },
    );
  }
}
