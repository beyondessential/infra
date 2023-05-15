import {
  ComponentResource,
  ComponentResourceOptions,
  Output,
  StackReference,
} from '@pulumi/pulumi';
import { FargateService } from '@pulumi/awsx/ecs';
import { Instance as DBInstance } from '@pulumi/aws/rds';

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

    // const central = this.service('central', { cores: 2, memoryGB: 4 });
    // const meta = this.service('meta', { cores: 1, memoryGB: 1, database: false });
    // const facility = this.service('facility', {
    //   cores: 2,
    //   memoryGB: 4,
    //   desiredCount: this.#args.numberOfFacilities,
    // });

    this.registerOutputs(
      (this.outputs = {
        database: this.#db.arn,
        databaseEndpoint: this.#db.endpoint,
        facilityCount: this.#args.numberOfFacilities,
        services: {
          // central: central.service.id,
          // meta: meta.service.id,
          // facility: facility.service.id,
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
        performanceInsightsEnabled: true,
        publiclyAccessible: false,
        storageType: 'gp3',
        username: 'postgres',
        vpcSecurityGroupIds: [dbSecGroup],
      },
      {
        parent: this,
      },
    );
  }

  database(name: string) {
    // TODO
  }

  service(
    imageName: string,
    { cores = 1, memoryGB = 1, desiredCount = 1, database = true }: TamanuClusterServiceArgs = {},
  ): FargateService {
    const image = this.#infra.getOutput(`repo${imageName[0].toUpperCase() + imageName.slice(1)}`);
    const cluster = this.#infra.getOutput('internalEcsCluster') as Output<string>;
    const subnets = (
      this.#infra.getOutput('internalSubnetsRt') as Output<string[]>
    );

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
