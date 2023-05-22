import { createHash } from 'crypto';
import {
  ComponentResource,
  ComponentResourceOptions,
  Config,
  Output,
  StackReference,
  jsonStringify,
} from '@pulumi/pulumi';
import { FargateService } from '@pulumi/awsx/ecs';
import { Instance as DBInstance } from '@pulumi/aws/rds';
import { Secret, SecretVersion } from '@pulumi/aws/secretsmanager';
import { Invocation } from '@pulumi/aws/lambda';

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
  index?: number;
  cores?: number;
  memoryGB?: number;
  scale?: number;
  database?: string | false;
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

    // const meta = this.service('meta', [], { cores: 1, memoryGB: 1, database: false });
    const central = {
      server: this.service('central', ['serve'], { cores: 2, memoryGB: 4 }),
      tasks: this.service('central', ['tasks'], { cores: 2, memoryGB: 4 }),
    };
    const facilities = Array.from({ length: this.#args.numberOfFacilities }).map((_, i) => ({
      server: this.service('facility', ['serve'], {
        index: i + 1,
      cores: 2,
        memoryGB: 2,
      }),
      tasks: this.service('facility', ['tasks'], {
        index: i + 1,
        cores: 2,
        memoryGB: 2,
      }),
    }));

    this.registerOutputs(
      (this.outputs = {
        database: this.#db.arn,
        databaseEndpoint: this.#db.endpoint,
        facilityCount: this.#args.numberOfFacilities,
        services: {
          // meta: meta.service.id,
          centralServer: central.server.service.id,
          centralTasks: central.tasks.service.id,
          ...Object.fromEntries(
            facilities.flatMap(({ server, tasks }, i) => [
              [`facility${i + 1}Server`, server.service.id],
              [`facility${i + 1}Tasks`, tasks.service.id],
            ]),
          ),
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
    const name = [kind, index].filter(Boolean).join('-');
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
      passwordFromSecret: secretMeta.arn,
      extensions: ['uuid-ossp'],
    };
  }

  runDbProvisioner() {
    const provisionConfig = [this.databaseProvisionConfig('central')];
    for (let i = 1; i <= this.#args.numberOfFacilities; i++) {
      this.databaseProvisionConfig('facility', i);
    }

    const dbProvisioner = this.#infra.getOutput(`internalDbProvisioner`) as Output<string>;

    new Invocation(
      `${this.#name}-provisioner`,
      {
        functionName: dbProvisioner,
        input: jsonStringify(provisionConfig),
      },
      { parent: this },
    );
  }

  service(
    imageName: string,
    command: string[],
    {
      index,
      cores = 1,
      memoryGB = 1,
      scale = 1,
      database = [imageName, index].filter(Boolean).join('-'),
    }: TamanuClusterServiceArgs = {},
  ): FargateService {
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
        image,
          command,
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
        desiredCount: scale,
        propagateTags: 'SERVICE',
        networkConfiguration: {
          subnets,
        },
      },
      { parent: this },
    );
  }
}
