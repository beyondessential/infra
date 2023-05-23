import { readFileSync } from 'fs';
import {
  ComponentResource,
  ComponentResourceOptions,
  Output,
  StackReference,
  jsonStringify,
} from '@pulumi/pulumi';
import { FargateService } from '@pulumi/awsx/ecs';
import { Parameter } from '@pulumi/aws/ssm';

export interface TamanuServerArgs {
  clusterName: string;
  imageName: string;
  imageTag: string;
  /** @default null */
  index?: number | null;
  /** @default 1 */
  cores?: number;
  /** @default 1 */
  memoryGB?: number;
  /** @default 1 */
  httpScale?: number;
  /** @default false */
  database?: string | false;
  /** @default false */
  configTemplate?: string | false;
}

export interface TamanuServerOutputs {
  http: Output<string>;
  tasks: Output<string>;
}

export class TamanuServer extends ComponentResource {
  #name: string;
  #args: Required<TamanuServerArgs>;
  #infra: StackReference;

  #config: Parameter | false;

  outputs: TamanuServerOutputs;

  constructor(name: string, args: TamanuServerArgs, opts: ComponentResourceOptions = {}) {
    super('pkg:index:TamanuServer', name, {}, opts);
    this.#name = name;
    this.#args = {
      index: null,
      cores: 1,
      memoryGB: 1,
      httpScale: 1,
      configTemplate: false,
      database: [args.imageName, args.index].filter(Boolean).join('-'),
      ...args,
    };
    this.#infra = new StackReference('bes/tamanu-infra/main', {}, { parent: this });

    this.#config =
      this.#args.configTemplate === false
        ? false
        : new Parameter(
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

  service(name: string, command: string[]): FargateService {
    const { imageName, memoryGB, cores, index, database, httpScale } = this.#args;
    const image = this.#infra.getOutput(`repo${imageName[0].toUpperCase() + imageName.slice(1)}`);
    const cluster = this.#infra.getOutput('internalEcsCluster') as Output<string>;
    const subnets = this.#infra.getOutput('internalSubnetsRt') as Output<string[]>;

    const task = {
      runtimePlatform: {
        operatingSystemFamily: 'LINUX',
        cpuArchitecture: 'X86_64',
      },
      containers: {
        main: {
          image: `${image}:${this.#args.imageTag}`,
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
          image: `alpine`,
          command: [],
          memory: 512,
          cpu: 256,
          essential: false,
          linuxParameters: {
            initProcessEnabled: true,
          },
          environment: [
            { name: '', value: '' },
            { name: '', value: '' },
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
                  // read secrets for the databases in this ECS cluster
                  database && {
                    Effect: 'Allow',
                    Action: ['secretsmanager:GetSecretValue'],
                    Resource: 'arn:aws:secretsmanager:ap-southeast-2:*:secret:tamanu-internal-db-*',
                  },
                  // read secrets for this application / Tamanu cluster
                  {
                    Effect: 'Allow',
                    Action: ['secretsmanager:GetSecretValue'],
                    Resource: `arn:aws:secretsmanager:ap-southeast-2:*:secret:tamanu-${
                      this.#args.clusterName
                    }-app-*`,
                  },
                  // read parameter for this server's config
                  this.#config && {
                    Effect: 'Allow',
                    Action: ['ssm:GetParameter'],
                    Resource: this.#config.arn,
                  },
                ].filter(Boolean),
              }),
            },
          ],
        },
      },
    };

    return new FargateService(
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
