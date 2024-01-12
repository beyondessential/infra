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
import { Cluster as ECSCluster } from '@pulumi/aws/ecs/index.js';
import { Service } from '@pulumi/aws/servicediscovery/index.js';
import { Parameter } from '@pulumi/aws/ssm/index.js';
import { Policy, PolicyAttachment, PolicyStatement, Role } from '@pulumi/aws/iam/index.js';
import { TargetGroup } from '@pulumi/aws/lb/index.js';
import { DEFAULT_PORT, Endpoint } from './Endpoint.js';

export interface ServerArgs {
  ecs: ECSCluster;
  endpoint: Endpoint;
  infra: StackReference;
  repos: StackReference;

  clusterName: string;
  imageName: string;
  imageTag: string;
  configTemplate: string;
  configuratorEnv?: { name: string; value: string | Input<string> }[];
  dbSecret: Output<string>;
  syncSecrets: Output<string>[];
  referenceDataBucket?: null | string;

  /**
   * Has to be in sync with memory and within supported Fargate sizings.
   * https://aws.amazon.com/fargate/pricing/
   *
   * @default 1
   */
  cores?: number;
  /**
   * Has to be in sync with cores and within supported Fargate sizings.
   *
   * @default 2
   */
  memoryGB?: number;
  /**
   * Number of tasks to start for the HTTP service.
   *
   * @default 1
   */
  httpScale?: number;

  // for facilities
  facilityId?: null | string;

  /** Any extra tags to add to all resources. */
  tags?: { [key: string]: string };
}

export class Server extends ComponentResource {
  #name: string;
  #args: Required<ServerArgs>;
  #infra: StackReference;
  #repos: StackReference;

  #config: Parameter;

  #isFacility: boolean;

  constructor(name: string, args: ServerArgs, opts: ComponentResourceOptions = {}) {
    super('bes:tamanu:Server', name, {}, opts);
    this.#name = name;
    this.#args = {
      facilityId: null,
      cores: 1,
      memoryGB: 2,
      httpScale: 1,
      configuratorEnv: [],
      referenceDataBucket: null,
      tags: {},
      ...args,
    };
    this.#infra = args.infra;
    this.#repos = args.repos;
    this.#isFacility = this.#args.facilityId !== null;

    this.#config = new Parameter(
      `${this.#args.clusterName}-${this.#name}-config`,
      {
        type: 'SecureString',
        description: `JSON config for Tamanu Internal deployment ${this.#args.clusterName}, ${
          this.#args.imageName
        } server ${this.#args.facilityId ?? ''}`,
        value: readFileSync(this.#args.configTemplate, 'utf8'),
        overwrite: true, // this + ignoreChanges = overwrite an existing config on create only
        tags: this.#args.tags,
      },
      { parent: this, ignoreChanges: ['value'] },
    );

    if (this.#isFacility) {
      this.service('http', [], {
        discovery: this.#args.endpoint.discovery,
        targetGroup: this.#args.endpoint.targetGroup,
        configuratorEnv: args.configuratorEnv,
        withMigrations: true,
        waitUntilStable: false,
      });
    } else {
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
    const securityGroup = this.#infra
      .getOutput('cluster')
      .apply((cluster) => cluster.containers.securityGroup as string);

    const images = this.#repos.getOutput('repos').apply((repos) => ({
      server: `${repos[imageName]}:${this.#args.imageTag}`,
      configurator: repos.configurator as string,
    }));

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

    // Reserve 64MB for non-Node long-running processes (e.g. supervisor, SSH)
    const RESERVED_MEMORY = 64;
    const containers: [string, awsx.types.input.ecs.TaskDefinitionContainerDefinitionArgs][] = [
      [
        'main',
        {
          image: images.server,
          command,
          essential: true,
          linuxParameters: {
            initProcessEnabled: true,
          },
          environment: [
            {
              name: 'NODE_OPTIONS',
              value: `--max-old-space-size=${memoryGB * 1024 - RESERVED_MEMORY}`,
            },
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
          image: images.configurator,
          command: [],
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
          image: images.server,
          command: ['migrate'],
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
      memory: (memoryGB * 1024).toString(),
      cpu: (cores * 1024).toString(),
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

        // Destroy-then-create instead of rolling updates, as Tamanu doesn't deal well with multiple
        // versions existing at once at the moment.
        deploymentMaximumPercent: 100,
        deploymentMinimumHealthyPercent: 0,

        // TODO: may not be needed? ECSexec?
        enableExecuteCommand: true,
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
