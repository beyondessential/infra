import {
  ComponentResource,
  ComponentResourceOptions,
  StackReference,
} from "@pulumi/pulumi";
import { FargateTaskDefinition } from "@pulumi/awsx/ecs";

interface TamanuClusterArgs {
  /** @default 2 */
  numberOfFacilities?: number;
}

class TamanuCluster extends ComponentResource {
  #infra: StackReference;

  constructor(
    name: string,
    args: TamanuClusterArgs = {},
    opts: ComponentResourceOptions = {}
  ) {
    super("pkg:index:TamanuCluster", name, {}, opts);

    const { numberOfFacilities = 2 } = args;

    this.#infra = new StackReference("bes/tamanu-infra/main");

    const central = this.container("central", { cores: 2, memoryGB: 4 });
    const meta = this.container("meta", { cores: 1, memoryGB: 1 });
    const facilities = Array.from({ length: numberOfFacilities }).map(
      (_, index) =>
        this.container("facility", { index: index + 1, cores: 2, memoryGB: 4 })
    );

    const task = new FargateTaskDefinition(
      name,
      {
        runtimePlatform: {
          operatingSystemFamily: "LINUX",
          cpuArchitecture: "X86_64",
        },
        containers: Object.fromEntries(
          [central, meta, ...facilities].map((c) => [c.name, c])
        ),
      },
      { parent: this }
    );

    this.registerOutputs({
      task: task.taskDefinition.arn,
    });
  }

  container(
    imageName: string,
    {
      cores = 1,
      memoryGB = 1,
      index = null,
    }: { cores?: number; memoryGB?: number; index?: number | null } = {}
  ) {
    const image = this.#infra
      .getOutput("repos")
      .apply((repos) => repos[imageName]);

    return {
      name: index ? `${imageName}-${index}` : imageName,
      image,
      memory: memoryGB * 1024,
      cpu: cores * 1024,
      essential: !(index && index > 1), // only for central, meta, and the first facility
    };
  }
}

export const cluster = new TamanuCluster("tamanu-internal");

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
