import {
  ComponentResource,
  ComponentResourceOptions,
  Output,
  StackReference,
  getStack,
} from '@pulumi/pulumi';
import { FargateService } from '@pulumi/awsx/ecs';
import { Instance as DBInstance } from '@pulumi/aws/rds';

interface TamanuClusterArgs {
  /** @default 2 */
  numberOfFacilities?: number;
}

class TamanuCluster extends ComponentResource {
  #infra: StackReference;
  #cluster: Output<string>;
  #subnet: Output<string>;
  #vpc: Output<string>;

  central: FargateService;
  meta: FargateService;
  facility: FargateService;
  facilityCount: number;

  constructor(name: string, args: TamanuClusterArgs = {}, opts: ComponentResourceOptions = {}) {
    super('pkg:index:TamanuCluster', name, {}, opts);

    const { numberOfFacilities = 2 } = args;
    this.facilityCount = numberOfFacilities;

    this.#infra = new StackReference('bes/tamanu-infra/main');
    this.#cluster = this.#infra.getOutput('internalEcsCluster') as Output<string>;
    this.#subnet = (this.#infra.getOutput('internalSubnets') as Output<string[]>)[0];
    this.#vpc = this.#infra.getOutput('internalVpc') as Output<string>;

    this.central = this.container('central', { cores: 2, memoryGB: 4 });
    this.meta = this.container('meta', { cores: 1, memoryGB: 1 });
    this.facility = this.container('facility', {
      cores: 2,
      memoryGB: 4,
      desiredCount: numberOfFacilities,
    });

    const dbSubnetGroup = this.#infra.getOutput('internalDbSubnetGroup') as Output<string>;
    const dbSecGroup = this.#infra.getOutput('internalDbSecGroup') as Output<string>;

    const db = new DBInstance(
      `tamanu-${name}`,
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

    this.registerOutputs({
      database: db.arn,
      facilityCount: this.facilityCount,
      services: {
        central: this.central.service.id,
        meta: this.meta.service.id,
        facility: this.facility.service.id,
      },
    });
  }

  container(
    imageName: string,
    {
      cores = 1,
      memoryGB = 1,
      desiredCount = 1,
    }: { cores?: number; memoryGB?: number; desiredCount?: number } = {},
  ): FargateService {
    const image = this.#infra.getOutput(`repo${imageName[0].toUpperCase() + imageName.slice(1)}`);

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
      imageName,
      {
        cluster: this.#cluster,
        taskDefinitionArgs: task,
        desiredCount,
        propagateTags: 'SERVICE',
        networkConfiguration: {
          subnets: [this.#subnet],
        },
      },
      { parent: this },
    );
  }
}

const cluster = new TamanuCluster(getStack());
export const { facilityCount } = cluster;
export const serviceCentral = cluster.central.service.apply((s) => s.id);
export const serviceMeta = cluster.meta.service.apply((s) => s.id);
export const serviceFacility = cluster.facility.service.apply((s) => s.id);

// // Stack Export
// export const ecsCluster = cluster.arn;
// export const rdsInstanceEndpoint = rdsInstance.endpoint;
