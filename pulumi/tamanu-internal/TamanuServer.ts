import { readFileSync } from 'fs';
import {
  ComponentResource,
  ComponentResourceOptions,
  Output,
  StackReference,
  jsonStringify,
} from '@pulumi/pulumi';
import * as awsx from '@pulumi/awsx';
import { Parameter } from '@pulumi/aws/ssm';

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
        overwrite: false,
      },
      { parent: this },
    );

    const http = this.service('http', ['serve']);
    const tasks = this.service('tasks', ['tasks']);

    this.registerOutputs(
      (this.outputs = {
        http: http.service.id,
        tasks: tasks.service.id,
      }),
    );
  }

  service(name: string, command: string[]): awsx.ecs.FargateService {
    const { imageName, memoryGB, cores, index, dbSecret, httpScale } =
      this.#args;
    const cluster = this.#infra.getOutput('cluster').apply(cluster => cluster.containers.ecs as string);
    const subnets = this.#infra.getOutput('network').apply(network => network.workloadSubnetIds as string[]);

    const serverImage = this.#infra.getOutput('repos').apply(repos => repos[imageName] as string);
    const configuratorImage = this.#infra.getOutput('repos').apply(repos => repos.configurator as string);

    const task: awsx.ecs.FargateTaskDefinitionArgs = {
      runtimePlatform: {
        operatingSystemFamily: 'LINUX',
        cpuArchitecture: 'X86_64',
      },
      containers: {
        main: {
          image: `${serverImage}:${this.#args.imageTag}`,
          command,
          memory: memoryGB * 1024,
          cpu: cores * 1024,
          essential: true,
          linuxParameters: {
            initProcessEnabled: true,
          },
          mountPoints: [
            {
              containerPath: '/config',
              sourceVolume: 'config',
              readOnly: true,
            },
          ],
        },
        configurator: {
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
            { name: 'TARGET_FILE', value: '/config/local.json' },
          ],
          mountPoints: [
            {
              containerPath: '/config',
              sourceVolume: 'config',
              readOnly: false,
            },
          ],
        },
      },
      volumes: [{ name: 'config' }],
      executionRole: {
        args: {
          inlinePolicies: [
            {
              policy: jsonStringify({
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
                ].filter(Boolean),
              }),
            },
          ],
        },
      },
    };

    return new awsx.ecs.FargateService(
      [this.#name, index, name].filter(Boolean).join('-'),
      {
        cluster,
        taskDefinitionArgs: task,
        continueBeforeSteadyState: true, // for now
        desiredCount: httpScale,
        propagateTags: 'SERVICE',
        networkConfiguration: {
          subnets,
        },
      },
      { parent: this },
    );
  }
}
