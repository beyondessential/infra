import { ComponentResource, ComponentResourceOptions, StackReference } from '@pulumi/pulumi';
import * as awsx from '@pulumi/awsx';
import * as awsClassic from '@pulumi/aws';
import { Endpoint } from './Endpoint.ts';
import { Frontend } from './Frontend.ts';
import { cpuArchitecture } from './config.ts';

export interface RouterArgs {
  ecs: awsClassic.ecs.Cluster;
  endpoint: Endpoint;
  infra: StackReference;
  repos: StackReference;
  clusterName: string;
  frontend: Frontend;

  /** Any extra tags to add to all resources. */
  tags?: { [key: string]: string };
}

export class Router extends ComponentResource {
  #name: string;
  #args: Required<RouterArgs>;
  #infra: StackReference;
  #repos: StackReference;

  constructor(name: string, args: RouterArgs, opts: ComponentResourceOptions = {}) {
    super('bes:tamanu:Router', name, {}, opts);
    this.#name = name;
    this.#args = {
      tags: {},
      ...args,
    };
    this.#infra = args.infra;
    this.#repos = args.repos;

    const subnets = this.#infra
      .getOutput('network')
      .apply((network) => network.workloadSubnetIds as string[]);
    const securityGroup = this.#infra
      .getOutput('cluster')
      .apply((cluster) => cluster.containers.securityGroup as string);

    const task: awsx.ecs.FargateTaskDefinitionArgs = {
      family: `${this.#args.clusterName}-${this.#name}-router`,
      memory: (0.5 * 1024).toString(),
      cpu: (0.25 * 1024).toString(),
      runtimePlatform: {
        operatingSystemFamily: 'LINUX',
        cpuArchitecture,
      },
      container: {
        name: 'haproxy',
        image: this.#repos.getOutput('repos').apply((repos) => repos['ecs-router']),
        essential: true,
        environment: [
          { name: 'SERVICE_DISCOVERY_API', value: this.#args.endpoint.discoveryDns },
          { name: 'SERVICE_DISCOVERY_WEB', value: this.#args.frontend.discoveryDns },
        ],
        portMappings: [
          {
            protocol: 'HTTP',
            containerPort: 80,
            targetGroup: this.#args.endpoint.targetGroup,
          },
          {
            protocol: 'HTTP',
            containerPort: 81,
            hostPort: 81,
          },
        ],
      },
      logGroup: {
        args: {
          namePrefix: `${this.#args.clusterName}-${this.#name}-router-`,
        },
      },
      tags: this.#args.tags,
    };

    new awsx.ecs.FargateService(
      `${this.#name}-router`,
      {
        cluster: this.#args.ecs.arn,
        taskDefinitionArgs: task,
        desiredCount: 1,
        propagateTags: 'SERVICE',
        networkConfiguration: {
          subnets,
          securityGroups: [securityGroup],
        },
        tags: this.#args.tags,
      },
      { parent: this },
    );
  }
}
