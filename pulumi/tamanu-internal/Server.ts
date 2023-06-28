import { readFileSync } from 'fs';
import {
  ComponentResource,
  ComponentResourceOptions,
  Input,
  Output,
  StackReference,
  jsonStringify,
} from '@pulumi/pulumi';
import * as awsx from '@pulumi/awsx';
import { Cluster as ECSCluster } from '@pulumi/aws/ecs';
import { Service } from '@pulumi/aws/servicediscovery';
import { Parameter } from '@pulumi/aws/ssm';
import { Policy, PolicyAttachment, PolicyStatement, Role } from '@pulumi/aws/iam';
import { TargetGroup } from '@pulumi/aws/lb';
import { DEFAULT_PORT, Endpoint } from './Endpoint';

export interface ServerArgs {
  ecs: ECSCluster;
  endpoint: Endpoint;
  infra: StackReference;

  clusterName: string;
  imageName: string;
  imageTag: string;
  configTemplate: string;
  configuratorEnv?: { name: string; value: string | Input<string> }[];
  dbSecret: Output<string>;
  syncSecrets: Output<string>[];
  referenceDataBucket?: null | string;

  /** @default 1 */
  cores?: number;
  /** @default 1 */
  memoryGB?: number;
  /** @default 1 */
  httpScale?: number;

  // for facilities
  index?: null | number;

  /** Any extra tags to add to all resources. */
  tags?: { [key: string]: string };
}

export class Server extends ComponentResource {
  #name: string;
  #args: Required<ServerArgs>;
  #infra: StackReference;

  #config: Parameter;

  index: null | number;

  constructor(name: string, args: ServerArgs, opts: ComponentResourceOptions = {}) {
    super('bes:tamanu:Server', name, {}, opts);
    this.#name = name;
    this.#args = {
      index: null,
      cores: 1,
      memoryGB: 1,
      httpScale: 1,
      configuratorEnv: [],
      referenceDataBucket: null,
      tags: {},
      ...args,
    };
    this.#infra = args.infra;
    this.index = this.#args.index;

    this.#config = new Parameter(
      `${this.#args.clusterName}-${this.#name}-config`,
      {
        type: 'SecureString',
        description: `JSON config for Tamanu Internal deployment ${this.#args.clusterName}, ${
          this.#args.imageName
        } server ${this.#args.index ?? ''}`,
        value: readFileSync(this.#args.configTemplate, 'utf8'),
        overwrite: true, // this + ignoreChanges = overwrite an existing config on create only
        tags: this.#args.tags,
      },
      { parent: this, ignoreChanges: ['value'] },
    );

    const provisioningFile = args.configuratorEnv?.find(
      ({ name }) => name === 'TARGET_PROVISIONING_FILE',
    )?.value;
    const tasks = this.service(
      'tasks',
      ['tasks', ...(provisioningFile ? ['--provisioning', provisioningFile] : [])],
      {
        configuratorEnv: args.configuratorEnv,
        withMigrations: true,
      },
    );
    this.service('http', ['serve'], {
      discovery: this.#args.endpoint.discovery,
      targetGroup: this.#args.endpoint.targetGroup,
      configuratorEnv: args.configuratorEnv,
      dependsOn: [tasks],
      waitUntilStable: false,
    });
  }

  service(
    name: string,
    command: (string | Input<string>)[],
    {
      configuratorEnv = [],
      withMigrations = false,
      discovery,
      targetGroup,
      dependsOn = [],
      waitUntilStable = true,
    }: ServiceOptions = {},
  ): awsx.ecs.FargateService {
    const { imageName, memoryGB, cores, syncSecrets, dbSecret, referenceDataBucket, httpScale } =
      this.#args;
    const subnets = this.#infra
      .getOutput('network')
      .apply((network) => network.workloadSubnetIds as string[]);

    const serverImage = this.#infra
      .getOutput('repos')
      .apply((repos) => `${repos[imageName]}:${this.#args.imageTag}`);
    const configuratorImage = this.#infra
      .getOutput('repos')
      .apply((repos) => repos.configurator as string);
    const securityGroup = this.#infra
      .getOutput('cluster')
      .apply((cluster) => cluster.containers.securityGroup as string);

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
        tags: this.#args.tags,
      },
      { parent: this },
    );
    const configuratorPolicy = new Policy(
      `${this.#name}-${name}-configurator`,
      {
        policy: {
          Version: '2012-10-17',
          Statement: [
            // read credentials for...
            {
              Effect: 'Allow',
              Action: ['secretsmanager:GetSecretValue'],
              Resource: [
                // ...the database
                dbSecret,

                // ...the sync auth
                ...syncSecrets,
              ],
            },
            // read parameter for this server's config
            {
              Effect: 'Allow',
              Action: ['ssm:GetParameter'],
              Resource: this.#config!.arn,
            },
            // fetch reference data (if required)
            ...(referenceDataBucket
              ? ([
                  {
                    Effect: 'Allow',
                    Action: [
                      // 's3:GetObject',
                      // // required to get accurate errors?
                      // 's3:ListBucket',
                      's3:*', // TODO: figure out which permissions are actually needed
                    ],
                    // Resource: `arn:aws:s3:::${referenceDataBucket}/*`,
                    Resource: `arn:aws:s3:::*`,
                  },
                ] as PolicyStatement[])
              : []),
          ],
        },
        tags: this.#args.tags,
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
          environment: [
            { name: 'NODE_CONFIG_STRICT_MODE', value: 'true' },
            ...(discovery && this.#args.endpoint.port !== DEFAULT_PORT
              ? [{ name: 'NODE_CONFIG', value: jsonStringify({ port: this.#args.endpoint.port }) }]
              : []),
          ],
          portMappings: discovery && [
            {
              protocol: 'HTTP',
              containerPort: this.#args.endpoint.port,
              targetGroup,
            },
          ],
          healthCheck: {
            command: ['CMD', '/entrypoint', 'healthcheck', ...command],
            startPeriod: 30,
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
            { name: 'TARGET_CONFIG_FILE', value: '/config/production.json' },
            ...configuratorEnv,
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
      family: `${this.#args.clusterName}-${this.#name}-${name}`,
      runtimePlatform: {
        operatingSystemFamily: 'LINUX',
        cpuArchitecture: 'X86_64',
      },
      containers: Object.fromEntries(containers),
      volumes: [{ name: 'config' }],
      taskRole: {
        roleArn: taskRole.arn,
      },
      logGroup: {
        args: {
          namePrefix: `${this.#args.clusterName}-${this.#name}-${name}-`,
        },
      },
      tags: this.#args.tags,
    };

    return new awsx.ecs.FargateService(
      [this.#name, name].filter(Boolean).join('-'),
      {
        cluster: this.#args.ecs.arn,
        taskDefinitionArgs: task,
        desiredCount: httpScale,
        continueBeforeSteadyState: !waitUntilStable,
        enableExecuteCommand: true,
        propagateTags: 'SERVICE',
        serviceRegistries: discovery && {
          port: this.#args.endpoint.port,
          registryArn: discovery.arn,
        },
        networkConfiguration: {
          subnets,
          securityGroups: [securityGroup],
        },
        tags: this.#args.tags,
      },
      { parent: this, dependsOn: [this.#config, ...dependsOn] },
    );
  }
}

interface ServiceOptions {
  configuratorEnv?: { name: string; value: string | Input<string> }[];
  withMigrations?: boolean;
  discovery?: Service;
  targetGroup?: TargetGroup;
  dependsOn?: ComponentResource[];
  waitUntilStable?: boolean;
}
