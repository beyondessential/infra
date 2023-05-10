import {
  ComponentResource,
  ComponentResourceOptions,
  Output,
  StackReference,
  log,
} from "@pulumi/pulumi";
import { FargateTaskDefinition, FargateService } from "@pulumi/awsx/ecs";

interface TamanuClusterArgs {
  /** @default 2 */
  numberOfFacilities?: number;
}

class TamanuCluster extends ComponentResource {
  #infra: StackReference;
  #cluster: Output<string>;
  #subnet: Output<string>;

  central: FargateService;
  meta: FargateService;
  facility: FargateService;
  facilityCount: number;

  constructor(
    name: string,
    args: TamanuClusterArgs = {},
    opts: ComponentResourceOptions = {}
  ) {
    super("pkg:index:TamanuCluster", name, {}, opts);

    const { numberOfFacilities = 2 } = args;
    this.facilityCount = numberOfFacilities;

    this.#infra = new StackReference("bes/tamanu-infra/main");
    this.#cluster = this.#infra.getOutput("internalEcsCluster") as Output<string>;
    this.#subnet = this.#infra.getOutput("internalSubnet") as Output<string>;

    this.central = this.container("central", { cores: 2, memoryGB: 4 });
    this.meta = this.container("meta", { cores: 1, memoryGB: 1 });
    this.facility = this.container("facility", {
      cores: 2,
      memoryGB: 4,
      desiredCount: numberOfFacilities,
    });

    this.registerOutputs({
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
    }: { cores?: number; memoryGB?: number; desiredCount?: number } = {}
  ): FargateService {
    const image = this.#infra
      .getOutput("repos")
      .apply((repos) => repos[imageName]);

    const task = {
      runtimePlatform: {
        operatingSystemFamily: "LINUX",
        cpuArchitecture: "X86_64",
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
        propagateTags: "SERVICE",
        networkConfiguration: {
          subnets: [this.#subnet],
        },
      },
      { parent: this }
    );
  }
}

const cluster = new TamanuCluster("tamanu-internal");
export const { facilityCount } = cluster;
export const services = {
  central: cluster.central.service.apply((s) => s.id),
  meta: cluster.meta.service.apply((s) => s.id),
  facility: cluster.facility.service.apply((s) => s.id),
};

// import { Instance as DBInstance } from "@pulumi/aws/rds";
// import { SecurityGroup } from "@pulumi/aws/ec2";
//
// // Create a security group for the RDS Instance
// const rdsSecurityGroup = new SecurityGroup("rds-security-group", {
//   vpc,
// });

// // Create an RDSInstance
// const rdsInstance = new DBInstance("rds-instance", {
//   allocatedStorage: 20,
//   engine: "mysql",
//   engineVersion: "8.0",
//   instanceClass: "db.t4g.medium", // Graviton (ARM) based instance class
//   dbSubnetGroupName: rdsSecurityGroup.subnetGroup.id,
//   vpcSecurityGroupIds: [rdsSecurityGroup.id],
//   username: "admin",
//   password: "your_secure_password",
//   availabilityZone: "YOUR_AWS_AVAILABILITY_ZONE", // Replace with your AWS availability zone
// });

// // Stack Export
// export const ecsCluster = cluster.arn;
// export const rdsInstanceEndpoint = rdsInstance.endpoint;
