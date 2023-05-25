import { Netmask } from 'netmask';
import { ComponentResource, ComponentResourceOptions, Output, output } from '@pulumi/pulumi';
import {
  Eip,
  InternetGateway,
  NatGateway,
  Route,
  RouteTable,
  RouteTableAssociation,
  Subnet,
  Vpc,
} from '@pulumi/aws/ec2';

export interface NetworkArgs {
  ipv4Cidr: string;
  zones?: string[];
  tags?: { [key: string]: string };
}

export interface SubnetOutput {
  id: Output<string>;
  zone: Output<string>;
  v4Cidr: Output<string>;
}

export interface NetworkOutputs {
  vpc: Output<string>;
  v4Cidr: Output<string>;
  natSubnets: SubnetOutput[];
  workloadSubnets: SubnetOutput[];
  natSubnetIds: Output<string[]>;
  workloadSubnetIds: Output<string[]>;
}

export class Network extends ComponentResource {
  #name: string;
  #args: Required<NetworkArgs>;

  #vpc: Vpc;
  #igw: InternetGateway;
  #nats: NatSubnet[];
  #workloads: SubnetBlock[];

  outputs: NetworkOutputs;

  constructor(name: string, args: NetworkArgs, opts: ComponentResourceOptions = {}) {
    super('pkg:index:Network', name, {}, opts);
    this.#name = name;
    this.#args = {
      zones: ['a', 'b', 'c'],
      tags: {},
      ...args,
    };

    // VPC is the top resource here.
    this.#vpc = new Vpc(
      name,
      {
        // both required for service discovery
        enableDnsSupport: true,
        enableDnsHostnames: true,

        cidrBlock: args.ipv4Cidr,
        tags: {
          Name: name,
          ...this.#args.tags,
        },
      },
      { parent: this },
    );

    // Internet Gateway sits outside the subnets, required for the NAT and such
    // to be able to access the internet, but not used directly for workloads.
    this.#igw = new InternetGateway(
      name,
      {
        vpcId: this.#vpc.id,
        tags: {
          Name: `${this.#name}-ingw`,
          ...this.#args.tags,
        },
      },
      { parent: this.#vpc },
    );

    // We use the first /24 for network appliances (NAT). However we don't
    // define an actual subnet for this, instead we create small /28s for each
    // AZ, which leaves a bunch of space reserved for future expansion. In a
    // perfect world /30s would even be enough, but AWS doesn't support that.
    const appliances = nthSubnetV4(this.#args.ipv4Cidr, 24, 0);
    this.#nats = this.#args.zones.map((zone, i) =>
      this.natSubnet(zone, nthSubnetV4(appliances, 28, i)),
    );

    // Main workload subnets, covering all AZs with a /24 each. That gives us
    // over 750 usable IPs, which is plenty for now.
    this.#workloads = this.#args.zones.map((zone, i) =>
      this.workloadSubnet(zone, i + 1, nthSubnetV4(this.#args.ipv4Cidr, 24, i + 1)),
    );

    this.registerOutputs(
      (this.outputs = {
        vpc: this.#vpc.id,
        v4Cidr: this.#vpc.cidrBlock.apply((cidr) => cidr!),
        natSubnets: this.#nats.map(subnetToOutput),
        workloadSubnets: this.#workloads.map(subnetToOutput),
        natSubnetIds: output(this.#nats.map((subnet) => subnet.subnet.id)),
        workloadSubnetIds: output(this.#workloads.map((subnet) => subnet.subnet.id)),
      }),
    );
  }

  natSubnet(zone: string, ipv4Block: string): NatSubnet {
    const name = `${this.#name}-nat-${zone}`;
    const tags = {
      Name: name,
      Purpose: 'nat',
      ...this.#args.tags,
    };

    const subnet = new Subnet(
      name,
      {
        vpcId: this.#vpc.id,
        cidrBlock: ipv4Block,
        availabilityZone: `ap-southeast-2${zone}`,
        mapPublicIpOnLaunch: true,
        privateDnsHostnameTypeOnLaunch: 'ip-name',
        tags,
      },
      {
        parent: this.#vpc,
      },
    );

    const ip = new Eip(name, { tags }, { parent: subnet });

    const nat = new NatGateway(
      name,
      {
        subnetId: subnet.id,
        connectivityType: 'public',
        allocationId: ip.allocationId,
        tags,
      },
      { parent: subnet, dependsOn: [this.#igw] },
    );

    const routes = new RouteTable(
      name,
      {
        vpcId: this.#vpc.id,
        tags,
      },
      { parent: subnet },
    );

    new Route(
      `${name}-out4`,
      {
        routeTableId: routes.id,
        destinationCidrBlock: '0.0.0.0/0',
        gatewayId: this.#igw.id,
      },
      { parent: routes },
    );

    new RouteTableAssociation(
      name,
      {
        routeTableId: routes.id,
        subnetId: subnet.id,
      },
      { parent: routes },
    );

    return {
      zone,
      subnet,
      nat,
      routes,
    };
  }

  workloadSubnet(zone: string, index: number, ipv4Block: string): SubnetBlock {
    const name = `${this.#name}-workload${index}-${zone}`;
    const tags = {
      Name: name,
      Purpose: 'workload',
      ...this.#args.tags,
    };

    const subnet = new Subnet(
      name,
      {
        vpcId: this.#vpc.id,
        cidrBlock: ipv4Block,
        availabilityZone: `ap-southeast-2${zone}`,
        mapPublicIpOnLaunch: false,
        privateDnsHostnameTypeOnLaunch: 'ip-name',
        tags,
      },
      {
        parent: this.#vpc,
      },
    );

    const routes = new RouteTable(
      name,
      {
        vpcId: this.#vpc.id,
        tags,
      },
      { parent: subnet },
    );

    new Route(
      `${name}-out4`,
      {
        routeTableId: routes.id,
        destinationCidrBlock: '0.0.0.0/0',
        natGatewayId: this.#nats.find((nat) => nat.zone === zone)?.nat.id,
      },
      { parent: routes },
    );

    new RouteTableAssociation(
      name,
      {
        routeTableId: routes.id,
        subnetId: subnet.id,
      },
      { parent: routes },
    );

    return {
      zone,
      subnet,
      routes,
    };
  }
}

export function nthSubnetV4(base: string, size: number, nth: number): string {
  let ipv4BlockCalc = new Netmask(new Netmask(base).base, size.toString());
  for (let i = 0; i < nth; i += 1) {
    ipv4BlockCalc = ipv4BlockCalc.next();
  }
  return ipv4BlockCalc.toString();
}

function subnetToOutput(block: SubnetBlock): SubnetOutput {
  return {
    id: block.subnet.id,
    zone: output(block.zone),
    v4Cidr: block.subnet.cidrBlock.apply((cidr) => cidr!),
  };
}

interface SubnetBlock {
  zone: string;
  subnet: Subnet;
  routes: RouteTable;
}

interface NatSubnet extends SubnetBlock {
  nat: NatGateway;
}
