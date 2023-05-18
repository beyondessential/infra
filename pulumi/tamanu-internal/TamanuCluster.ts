import {
  ComponentResource,
  ComponentResourceOptions,
  Output,
  StackReference,
} from '@pulumi/pulumi';
import { FargateService, FargateTaskDefinition } from '@pulumi/awsx/ecs';
import { Instance as DBInstance } from '@pulumi/aws/rds';
import { EcsRunTask } from '../common/EcsRunTask';

export interface TamanuClusterArgs {
  /** @default 2 */
  numberOfFacilities?: number;
}

export interface TamanuClusterOutputs {
  database: Output<string>;
  databaseEndpoint: Output<string>;
  facilityCount: number;
  services: {
    [name: string]: Output<string>;
  };
}

export interface TamanuClusterServiceArgs {
  cores?: number;
  memoryGB?: number;
  desiredCount?: number;
  database?: boolean;
}

export class TamanuCluster extends ComponentResource {
  #name: string;
  #args: Required<TamanuClusterArgs>;
  #infra: StackReference;

  outputs: TamanuClusterOutputs;

  #db: DBInstance;

  constructor(name: string, args: TamanuClusterArgs = {}, opts: ComponentResourceOptions = {}) {
    super('pkg:index:TamanuCluster', name, {}, opts);
    this.#name = name;
    this.#args = { numberOfFacilities: 2, ...args };
    this.#infra = new StackReference('bes/tamanu-infra/main', {}, { parent: this });

    this.#db = this.setupRds();
    this.runDbProvisioner();

    const central = this.service('central', { cores: 2, memoryGB: 4 });
    const meta = this.service('meta', { cores: 1, memoryGB: 1, database: false });
    const facility = this.service('facility', {
      cores: 2,
      memoryGB: 4,
      desiredCount: this.#args.numberOfFacilities,
    });

    this.registerOutputs(
      (this.outputs = {
        database: this.#db.arn,
        databaseEndpoint: this.#db.endpoint,
        facilityCount: this.#args.numberOfFacilities,
        services: {
          central: central.service.id,
          meta: meta.service.id,
          facility: facility.service.id,
        },
      }),
    );
  }

  setupRds() {
    const dbSubnetGroup = this.#infra.getOutput('internalDbSubnetGroup') as Output<string>;
    const dbSecGroup = this.#infra.getOutput('internalDbSecGroup') as Output<string>;

    return new DBInstance(
      `tamanu-${this.#name}`,
      {
        allocatedStorage: 20,
        autoMinorVersionUpgrade: true,
        dbSubnetGroupName: dbSubnetGroup,
        engine: 'postgres',
        engineVersion: '14.6',
        instanceClass: 'db.t4g.medium', // ARM64
        manageMasterUserPassword: true,
        networkType: 'DUAL',
        performanceInsightsEnabled: false, // adds two minutes to the boot/create time
        publiclyAccessible: false,
        skipFinalSnapshot: true, // tamanu-internal DBs should never contain important data
        storageType: 'gp3',
        username: 'postgres',
        vpcSecurityGroupIds: [dbSecGroup],
      },
      {
        parent: this,
      },
    );
  }

  databaseProvisionConfig(kind: string, index?: number) {
    const name = `${kind}${index ? `-${index}` : ''}`;
    const secretMeta = new Secret(
      name,
      {
        namePrefix: `tamanu-internal-db-${this.#name}-`,
        description: `PostgresSQL credentials for Tamanu Internal deployment ${
          this.#name
        }, ${kind} server ${index ?? ''}`,
      },
      { parent: this },
    );

    // Make the secret deterministic from the db name and a per-stack salt,
    // so it doesn't change on every invocation but is still reasonable secure.
    // !! For production setups, this should be redone with e.g. Bitwarden. !!
    const cfg = new Config();
    const salt = cfg.requireSecret('salt');
    const password = salt.apply((salt) =>
      createHash('sha256').update(salt).update(name).digest('hex'),
    );

    new SecretVersion(
      name,
      {
        secretId: secretMeta.id,
        secretString: jsonStringify({
          database: name,
          username: name,
          password,
        }),
      },
      {
        parent: secretMeta,
      },
    );

    return {
      database: name,
      owner: name,
      password,
    };
  }

  runDbProvisioner() {
    const provisionConfig = [this.databaseProvisionConfig('central')];
    for (let i = 1; i <= this.#args.numberOfFacilities; i++) {
      this.databaseProvisionConfig('facility', i);
    }

    const taskDefinition = new FargateTaskDefinition(
      `${this.#name}-provisioner`,
      {
        family: `tamanu-${this.#name}-provisioner`,
        runtimePlatform: {
          operatingSystemFamily: 'LINUX',
          cpuArchitecture: 'X86_64',
        },
        container: {
          image: 'alpine',
          command: ['env'],
          memory: 512,
          cpu: 512,
          essential: true,
          linuxParameters: {
            initProcessEnabled: true,
          },
          environment: [
            { name: 'PG_HOST', value: this.#db.endpoint },
            { name: 'PG_USER', value: this.#db.username },
            {
              name: 'PROVISION_CONFIG',
              value: jsonStringify(provisionConfig),
            },
          ],
          secrets: [
            {
              name: 'PG_PASSWORD',
              valueFrom: this.#db.masterUserSecrets.apply(
                ([firstSecret]) => `${firstSecret.secretArn}:password::`,
              ),
            },
          ],
        },
        executionRole: {
          args: {
            inlinePolicies: [
              {
                name: 'secretsmanager-getdbsecret',
                policy: jsonStringify({
                  Version: '2012-10-17',
                  Statement: [
                    {
                      Effect: 'Allow',
                      Action: ['secretsmanager:GetSecretValue'],
                      Resource: this.#db.masterUserSecrets[0].secretArn,
                    },
                  ],
                }),
              },
            ],
          },
        },
      },
      {
        parent: this,
      },
    );

    const cluster = this.#infra.getOutput('internalEcsCluster') as Output<string>;
    new EcsRunTask(
      `${this.#name}-provisioner`,
      {
        cluster,
        taskDefinition: taskDefinition.taskDefinition.apply((td) => td.arn),
      },
      { parent: this },
    );
  }

  service(
    imageName: string,
    { cores = 1, memoryGB = 1, desiredCount = 1, database = true }: TamanuClusterServiceArgs = {},
  ): FargateService {
    const image = this.#infra.getOutput(`repo${imageName[0].toUpperCase() + imageName.slice(1)}`);
    const cluster = this.#infra.getOutput('internalEcsCluster') as Output<string>;
    const subnets = this.#infra.getOutput('internalSubnetsRt') as Output<string[]>;

    const task = {
      runtimePlatform: {
        operatingSystemFamily: 'LINUX',
        cpuArchitecture: 'X86_64',
      },
      container: {
        image,
        memory: memoryGB * 1024,
        cpu: cores * 1024,
        essential: true,
        linuxParameters: {
          initProcessEnabled: true,
        },
        environment: [
          { name: 'PG_HOST', value: this.#db.endpoint },
        ],
      },
    };

    return new FargateService(
      `${this.#name}-${imageName}`,
      {
        cluster,
        taskDefinitionArgs: task,
        desiredCount,
        propagateTags: 'SERVICE',
        networkConfiguration: {
          subnets,
        },
      },
      { parent: this },
    );
  }
}
