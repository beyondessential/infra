import { readFileSync } from 'fs';
import {
  ComponentResource,
  ComponentResourceOptions,
  Output,
  StackReference,
  jsonStringify,
} from '@pulumi/pulumi';
import * as awsx from '@pulumi/awsx';
import { Service } from '@pulumi/aws/servicediscovery';
import { Parameter } from '@pulumi/aws/ssm';
import { Policy, PolicyAttachment, Role } from '@pulumi/aws/iam';

export interface TamanuServerArgs {
  clusterName: string;
  imageName: string;
  imageTag: string;
  configTemplate: string;
  dbSecret: Output<string>;

  /** @default 1 */
  cores?: number;
  /** @default 1 */
  memoryGB?: number;
  /** @default 1 */
  httpScale?: number;

  // for facilities
  index?: null | number;
}

export interface TamanuServerOutputs {
  http: Output<string>;
  tasks: Output<string>;
}

export class TamanuServer extends ComponentResource {
  #name: string;
  #args: Required<TamanuServerArgs>;
  #infra: StackReference;

  #config: Parameter;

  outputs: TamanuServerOutputs;

  constructor(name: string, args: TamanuServerArgs, opts: ComponentResourceOptions = {}) {
    super('pkg:index:TamanuServer', name, {}, opts);
    this.#name = name;
    this.#args = {
      index: null,
      cores: 1,
      memoryGB: 1,
      httpScale: 1,
      ...args,
    };
    this.#infra = new StackReference('bes/tamanu-infra/main', {}, { parent: this });

    this.#config = new Parameter(
      `${this.#name}-config`,
      {
        type: 'SecureString',
        description: `JSON config for Tamanu Internal deployment ${this.#args.clusterName}, ${
          this.#args.imageName
        } server ${this.#args.index ?? ''}`,
        value: readFileSync(this.#args.configTemplate, 'utf8'),
        overwrite: true,
      },
      { parent: this },
    );

    const namespace = this.#infra
      .getOutput('cluster')
      .apply((cluster) => cluster.containers.discovery as string);

    const discovery = new Service(
      `${this.#args.clusterName}-${this.#name}`,
      {
        dnsConfig: {
          namespaceId: namespace,
          dnsRecords: [
            { ttl: 10, type: 'A' },
            { ttl: 10, type: 'SRV' },
          ],
        },
        healthCheckCustomConfig: {
          failureThreshold: 3,
        },
      },
      {
        parent: this,
      },
    );

    const tasks = this.service('tasks', ['tasks'], { withMigrations: true });
    const http = this.service('http', ['serve'], { discovery, dependsOn: [tasks] });

    this.registerOutputs(
      (this.outputs = {
        http: http.service.id,
        tasks: tasks.service.id,
      }),
    );
  }

  service(
    name: string,
    command: string[],
    { withMigrations = false, discovery, dependsOn = [] }: ServiceOptions = {},
  ): awsx.ecs.FargateService {
    const { imageName, memoryGB, cores, index, dbSecret, httpScale } = this.#args;
    const cluster = this.#infra
      .getOutput('cluster')
      .apply((cluster) => cluster.containers.ecs as string);
    const subnets = this.#infra
      .getOutput('network')
      .apply((network) => network.workloadSubnetIds as string[]);

    const serverImage = this.#infra
      .getOutput('repos')
      .apply((repos) => `${repos[imageName]}:${this.#args.imageTag}`);
    const configuratorImage = this.#infra
      .getOutput('repos')
      .apply((repos) => repos.configurator as string);

    const taskRole = new Role(
      `${this.#name}-${name}-task`,
      {
        assumeRolePolicy: {
          Version: '2012-10-17',
          Statement: [
            {
              Effect: 'Allow',
              Principal: {
                Service: 'ecs-tasks.amazonaws.com',
              },
              Action: 'sts:AssumeRole',
            },
          ],
        },
      },
      { parent: this },
    );
    const configuratorPolicy = new Policy(
      `${this.#name}-${name}-configurator`,
      {
        policy: {
          Version: '2012-10-17',
          Statement: [
            // read credentials for this Tamanu cluster's database
            {
              Effect: 'Allow',
              Action: ['secretsmanager:GetSecretValue'],
              Resource: dbSecret,
            },
            // read parameter for this server's config
            {
              Effect: 'Allow',
              Action: ['ssm:GetParameter'],
              Resource: this.#config!.arn,
            },
          ],
        },
      },
      { parent: taskRole },
    );
    new PolicyAttachment(
      `${this.#name}-${name}-configurator`,
      {
        roles: [taskRole],
        policyArn: configuratorPolicy.arn,
      },
      { parent: taskRole },
    );
    new PolicyAttachment(
      `${this.#name}-${name}-ssmexec`,
      {
        roles: [taskRole],
        policyArn: this.#infra.getOutput('ssmExecPolicy'),
      },
      { parent: taskRole },
    );

    const containers: [string, awsx.types.input.ecs.TaskDefinitionContainerDefinitionArgs][] = [
      [
        'main',
        {
          image: serverImage,
          command,
          memory: memoryGB * 1024,
          cpu: cores * 1024,
          essential: true,
          linuxParameters: {
            initProcessEnabled: true,
          },
          environment: [{ name: 'NODE_CONFIG_STRICT_MODE', value: 'true' }],
          portMappings: discovery && [{ containerPort: 3000, protocol: 'HTTP' }],
          healthCheck: {
            command: ['CMD', 'healthcheck', ...command],
            startPeriod: 10,
          },
          mountPoints: [
            {
              containerPath: '/config',
              sourceVolume: 'config',
              readOnly: true,
            },
          ],
          dependsOn: [
            // start after the configurator is done
            { containerName: 'configurator', condition: 'SUCCESS' },
            // start after migrations are applied
            ...(withMigrations ? [{ containerName: 'migrator', condition: 'SUCCESS' }] : []),
          ],
        },
      ],
      [
        'configurator',
        {
          image: configuratorImage,
          command: [],
          memory: 512,
          cpu: 256,
          essential: false,
          linuxParameters: {
            initProcessEnabled: true,
          },
          environment: [
            { name: 'RUST_LOG', value: 'info' },
            { name: 'CONFIG_PARAMETER_NAME', value: this.#config.name },
            dbSecret.apply((value) => ({ name: 'DB_SECRET', value })),
            { name: 'TARGET_FILE', value: '/config/production.json' },
          ],
          mountPoints: [
            {
              containerPath: '/config',
              sourceVolume: 'config',
              readOnly: false,
            },
          ],
        },
      ],
    ];

    if (withMigrations) {
      containers.push([
        'migrator',
        {
          image: serverImage,
          command: ['migrate'],
          memory: 1024,
          cpu: 1024,
          essential: false,
          linuxParameters: {
            initProcessEnabled: true,
          },
          environment: [{ name: 'NODE_CONFIG_STRICT_MODE', value: 'true' }],
          mountPoints: [
            {
              containerPath: '/config',
              sourceVolume: 'config',
              readOnly: true,
            },
          ],
          dependsOn: [
            // start after the configurator is done
            { containerName: 'configurator', condition: 'SUCCESS' },
          ],
        },
      ]);
    }

    const task: awsx.ecs.FargateTaskDefinitionArgs = {
      runtimePlatform: {
        operatingSystemFamily: 'LINUX',
        cpuArchitecture: 'X86_64',
      },
      containers: Object.fromEntries(containers),
      volumes: [{ name: 'config' }],
      taskRole: {
        roleArn: taskRole.arn,
      },
    };

    return new awsx.ecs.FargateService(
      [this.#name, index, name].filter(Boolean).join('-'),
      {
        cluster,
        taskDefinitionArgs: task,
        desiredCount: httpScale,
        enableExecuteCommand: true,
        propagateTags: 'SERVICE',
        serviceRegistries: discovery && {
          port: 3000,
          registryArn: discovery.arn,
        },
        networkConfiguration: {
          subnets,
        },
      },
      { parent: this, dependsOn: [this.#config, ...dependsOn] },
    );
  }
}

interface ServiceOptions {
  withMigrations?: boolean;
  discovery?: Service;
  dependsOn?: ComponentResource[];
}
