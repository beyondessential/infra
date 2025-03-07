import { Netmask } from 'netmask';
import {
  ComponentResource,
  ComponentResourceOptions,
  Output,
  StackReference,
  interpolate,
  output,
} from '@pulumi/pulumi';
import {
  EgressOnlyInternetGateway,
  Eip,
  InternetGateway,
  NatGateway,
  Route,
  RouteTable,
  RouteTableAssociation,
  Subnet,
  Vpc,
} from '@pulumi/aws/ec2/index.js';

export interface NetworkArgs {
  ipv4Cidr?: false | string;
  v6?: boolean;
  privateSubnets?: boolean;
  publicSubnets?: boolean;
  zones?: string[];
  eksSubnetTags?: false | { [key: string]: string };
  tags?: { [key: string]: string };
}

export interface SubnetOutput {
  id: Output<string>;
  zone: Output<string>;
  v4Cidr: Output<undefined | string>;
  v6Cidr: Output<undefined | string>;
}

export interface NetworkOutputs {
  vpc: Output<string>;
  v4Cidr: Output<undefined | string>;
  v6Cidr: Output<undefined | string>;
  natSubnets: SubnetOutput[];
  workloadSubnets: SubnetOutput[];
  publicWorkloadSubnets: SubnetOutput[];
  natSubnetIds: Output<string[]>;
  workloadSubnetIds: Output<string[]>;
  publicWorkloadSubnetIds: Output<string[]>;
}

interface SubnetBlock {
  zone: string;
  subnet: Subnet;
  routes: RouteTable;
  nat?: NatGateway;
}

export class Network extends ComponentResource {
  readonly name: string;
  #args: Required<NetworkArgs>;

  readonly vpc: Vpc;
  readonly ingw?: InternetGateway;
  readonly v6outgw?: EgressOnlyInternetGateway;
  readonly nats: SubnetBlock[];
  readonly workloads: SubnetBlock[];
  readonly publicWorkloads: SubnetBlock[];

  readonly outputs: NetworkOutputs;

  constructor(name: string, args: NetworkArgs, opts: ComponentResourceOptions = {}) {
    super('bes:common:Network', name, {}, opts);
    this.name = name;
    this.#args = {
      ipv4Cidr: false,
      v6: false,
      privateSubnets: true,
      publicSubnets: true,
      zones: ['a', 'b', 'c'],
      eksSubnetTags: false,
      tags: {},
      ...args,
    };

    // VPC is the top resource here.
    this.vpc = new Vpc(
      name,
      {
        cidrBlock: args.ipv4Cidr || undefined,
        assignGeneratedIpv6CidrBlock: args.v6,

        // both required for service discovery and VPC endpoints
        enableDnsSupport: true,
        enableDnsHostnames: true,

        // just always useful
        enableNetworkAddressUsageMetrics: true,

        tags: {
          Name: name,
          ...this.#args.tags,
        },
      },
      { parent: this },
    );

    // V4 Internet Gateway sits outside the subnets, required for NAT and public
    // workloads to be able to access the V4 internet, but not used directly for
    // private workloads.
    this.ingw = args.ipv4Cidr
      ? new InternetGateway(
          name,
          {
            vpcId: this.vpc.id,
            tags: {
              Name: `${this.name}-ingw4`,
              ...this.#args.tags,
            },
          },
          { parent: this.vpc },
        )
      : undefined;

    // V6 Egress-only Internet Gateway sits outside the subnets, used by private
    // subnets to access the V6 internet.
    this.v6outgw =
      args.v6 && this.#args.privateSubnets
        ? new EgressOnlyInternetGateway(
            name,
            {
              vpcId: this.vpc.id,
              tags: {
                Name: `${this.name}-ingw6`,
                ...this.#args.tags,
              },
            },
            { parent: this.vpc },
          )
        : undefined;

    // We use the first /24 for network appliances (NAT). However we don't
    // define an actual subnet for this, instead we create small /28s for each
    // AZ, which leaves a bunch of space reserved for future expansion. In a
    // perfect world /30s would even be enough, but AWS doesn't support that.
    const appliancesV4 = this.#args.ipv4Cidr && nthSubnetV4(this.#args.ipv4Cidr, 24, 0);
    this.nats = this.#args.privateSubnets
      ? this.#args.zones.map((zone, i) =>
          this.natSubnet(zone, {
            ipv4Block: appliancesV4 ? nthSubnetV4(appliancesV4, 28, i) : undefined,
            ipv6Block: args.v6 ? nthSubnetV6(this.vpc.ipv6CidrBlock, i) : undefined,
          }),
        )
      : [];

    // Private workload subnets, covering all AZs with a v4 /24 each, and a v6 /64.
    // That gives us over 750 usable IPv4s, and basically infinite IPv6s.
    this.workloads = this.#args.privateSubnets
      ? this.#args.zones.map((zone, i) =>
          this.workloadSubnet(zone, i + 1, {
            ipv4Block: this.#args.ipv4Cidr
              ? nthSubnetV4(this.#args.ipv4Cidr, 24, i + 1)
              : undefined,
            ipv6Block: args.v6
              ? nthSubnetV6(this.vpc.ipv6CidrBlock, this.nats.length + i)
              : undefined,
          }),
        )
      : [];

    // Public workload subnets, covering all AZs with a v4 /24 each, and a v6 /64.
    // That gives us over 750 usable IPv4s, and basically infinite IPv6s.
    this.publicWorkloads = this.#args.publicSubnets
      ? this.#args.zones.map((zone, i) =>
          this.publicWorkloadSubnet(zone, i + 1, {
            ipv4Block: this.#args.ipv4Cidr
              ? nthSubnetV4(this.#args.ipv4Cidr, 24, this.#args.zones.length + i + 1)
              : undefined,
            ipv6Block: args.v6
              ? nthSubnetV6(this.vpc.ipv6CidrBlock, this.#args.zones.length * 2 + i)
              : undefined,
          }),
        )
      : [];
    // these always come "after" the private workloads, even if they're disabled,
    // so that the indexes are consistent and we can opt in/out without deleting
    // and recreating subnets.

    this.registerOutputs(
      (this.outputs = {
        vpc: this.vpc.id,
        v4Cidr: this.vpc.cidrBlock.apply((cidr) => cidr),
        v6Cidr: this.vpc.ipv6CidrBlock.apply((cidr) => cidr),
        natSubnets: this.nats.map(subnetToOutput),
        workloadSubnets: this.workloads.map(subnetToOutput),
        publicWorkloadSubnets: this.publicWorkloads.map(subnetToOutput),
        natSubnetIds: output(this.nats.map((subnet) => subnet.subnet.id)),
        workloadSubnetIds: output(this.workloads.map((subnet) => subnet.subnet.id)),
        publicWorkloadSubnetIds: output(this.publicWorkloads.map((subnet) => subnet.subnet.id)),
      }),
    );
  }

  natSubnet(
    zone: string,
    { ipv4Block, ipv6Block }: { ipv4Block?: string; ipv6Block?: Output<string> },
  ): SubnetBlock {
    const name = `${this.name}-nat-${zone}`;
    const tags = {
      Name: name,
      Purpose: 'nat',
      ...this.#args.tags,
    };

    const ipv6Only = !!(!ipv4Block && ipv6Block);
    const region = output(import('./awsAccount').then(a => a.region));

    const subnet = new Subnet(
      name,
      {
        vpcId: this.vpc.id,
        cidrBlock: ipv4Block,
        ipv6CidrBlock: ipv6Block,
        ipv6Native: ipv6Only,
        availabilityZone: interpolate`${region}${zone}`,
        mapPublicIpOnLaunch: true,
        assignIpv6AddressOnCreation: !!ipv6Block,
        enableDns64: ipv6Only,
        enableResourceNameDnsARecordOnLaunch: !!ipv4Block,
        enableResourceNameDnsAaaaRecordOnLaunch: !!ipv6Block,
        privateDnsHostnameTypeOnLaunch: ipv6Block ? 'resource-name' : 'ip-name',
        tags: {
          ...tags,
          ...(this.#args.eksSubnetTags
            ? {
                'kubernetes.io/role/elb': '1',
                ...this.#args.eksSubnetTags,
              }
            : {}),
        },
      },
      {
        parent: this.vpc,
        // these are nice-to-have but can't be enabled when updating an existing
        ignoreChanges: [
          'enableResourceNameDnsARecordOnLaunch',
          'enableResourceNameDnsAaaaRecordOnLaunch',
        ],
      },
    );

    const routes = new RouteTable(
      name,
      {
        vpcId: this.vpc.id,
        tags,
      },
      { parent: subnet },
    );
    new RouteTableAssociation(
      name,
      {
        routeTableId: routes.id,
        subnetId: subnet.id,
      },
      { parent: routes },
    );

    const ipv4 = !!ipv4Block && new Eip(name, { tags }, { parent: subnet });
    const nat = ipv4
      ? new NatGateway(
          name,
          {
            subnetId: subnet.id,
            connectivityType: 'public',
            allocationId: ipv4.allocationId,
            tags,
          },
          { parent: subnet, dependsOn: [this.ingw!] },
        )
      : undefined;

    this.ingw &&
      new Route(
        `${name}-out4`,
        {
          routeTableId: routes.id,
          destinationCidrBlock: '0.0.0.0/0',
          gatewayId: this.ingw.id,
        },
        { parent: routes },
      );

    this.#args.v6 && this.ingw &&
      new Route(
        `${name}-out6`,
        {
          routeTableId: routes.id,
          destinationIpv6CidrBlock: '::/0',
          gatewayId: this.ingw.id,
        },
        { parent: routes },
      );

    nat &&
      this.v6outgw &&
      new Route(
        `${name}-out64`,
        {
          routeTableId: routes.id,
          destinationIpv6CidrBlock: '64:ff9b::/96',
          natGatewayId: nat.id,
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

  workloadSubnet(
    zone: string,
    index: number,
    { ipv4Block, ipv6Block }: { ipv4Block?: string; ipv6Block?: Output<string> },
  ): SubnetBlock {
    const name = `${this.name}-workload${index}-${zone}`;
    const tags = {
      Name: name,
      Purpose: 'workload',
      ...this.#args.tags,
    };

    const ipv6Only = !!(!ipv4Block && ipv6Block);
    const region = output(import('./awsAccount').then(a => a.region));

    const subnet = new Subnet(
      name,
      {
        vpcId: this.vpc.id,
        cidrBlock: ipv4Block,
        ipv6CidrBlock: ipv6Block,
        ipv6Native: ipv6Only,
        availabilityZone: interpolate`${region}${zone}`,
        mapPublicIpOnLaunch: false,
        assignIpv6AddressOnCreation: !!ipv6Block,
        enableDns64: ipv6Only,
        enableResourceNameDnsARecordOnLaunch: !!ipv4Block,
        enableResourceNameDnsAaaaRecordOnLaunch: !!ipv6Block,
        privateDnsHostnameTypeOnLaunch: ipv6Block ? 'resource-name' : 'ip-name',
        tags: {
          ...tags,
          ...(this.#args.eksSubnetTags
            ? {
                'kubernetes.io/role/internal-elb': '1',
                ...this.#args.eksSubnetTags,
              }
            : {}),
        },
      },
      {
        parent: this.vpc,
        // these are nice-to-have but can't be enabled when updating an existing
        ignoreChanges: [
          'enableResourceNameDnsARecordOnLaunch',
          'enableResourceNameDnsAaaaRecordOnLaunch',
        ],
      },
    );

    const routes = new RouteTable(
      name,
      {
        vpcId: this.vpc.id,
        tags,
      },
      { parent: subnet },
    );
    new RouteTableAssociation(
      name,
      {
        routeTableId: routes.id,
        subnetId: subnet.id,
      },
      { parent: routes },
    );

    const nat = this.nats.find((nat) => nat.zone === zone)?.nat;

    nat &&
      new Route(
        `${name}-out4`,
        {
          routeTableId: routes.id,
          destinationCidrBlock: '0.0.0.0/0',
          natGatewayId: nat.id,
        },
        { parent: routes },
      );

    this.v6outgw &&
      new Route(
        `${name}-out6`,
        {
          routeTableId: routes.id,
          destinationIpv6CidrBlock: '::/0',
          egressOnlyGatewayId: this.v6outgw.id,
        },
        { parent: routes },
      );

    nat &&
      this.v6outgw &&
      new Route(
        `${name}-out64`,
        {
          routeTableId: routes.id,
          destinationIpv6CidrBlock: '64:ff9b::/96',
          natGatewayId: nat.id,
        },
        { parent: routes },
      );

    return {
      zone,
      subnet,
      routes,
      nat,
    };
  }

  publicWorkloadSubnet(
    zone: string,
    index: number,
    { ipv4Block, ipv6Block }: { ipv4Block?: string; ipv6Block?: Output<string> },
  ): SubnetBlock {
    const name = `${this.name}-pubworkload${index}-${zone}`;
    const tags = {
      Name: name,
      Purpose: 'workload',
      ...this.#args.tags,
    };

    const ipv6Only = !!(!ipv4Block && ipv6Block);
    const region = output(import('./awsAccount').then(a => a.region));

    const subnet = new Subnet(
      name,
      {
        vpcId: this.vpc.id,
        cidrBlock: ipv4Block,
        ipv6CidrBlock: ipv6Block,
        ipv6Native: ipv6Only,
        availabilityZone: interpolate`${region}${zone}`,
        mapPublicIpOnLaunch: true,
        assignIpv6AddressOnCreation: !!ipv6Block,
        enableDns64: ipv6Only,
        enableResourceNameDnsARecordOnLaunch: !!ipv4Block,
        enableResourceNameDnsAaaaRecordOnLaunch: !!ipv6Block,
        privateDnsHostnameTypeOnLaunch: ipv6Block ? 'resource-name' : 'ip-name',
        tags: {
          ...tags,
          ...(this.#args.eksSubnetTags
            ? {
                'kubernetes.io/role/elb': '1',
                ...this.#args.eksSubnetTags,
              }
            : {}),
        },
      },
      {
        parent: this.vpc,
        // these are nice-to-have but can't be enabled when updating an existing
        ignoreChanges: [
          'enableResourceNameDnsARecordOnLaunch',
          'enableResourceNameDnsAaaaRecordOnLaunch',
        ],
      },
    );

    const routes = new RouteTable(
      name,
      {
        vpcId: this.vpc.id,
        tags,
      },
      { parent: subnet },
    );
    new RouteTableAssociation(
      name,
      {
        routeTableId: routes.id,
        subnetId: subnet.id,
      },
      { parent: routes },
    );

    this.ingw &&
      new Route(
        `${name}-out4`,
        {
          routeTableId: routes.id,
          destinationCidrBlock: '0.0.0.0/0',
          gatewayId: this.ingw.id,
        },
        { parent: routes },
      );

    this.#args.v6 &&
      this.ingw &&
      new Route(
        `${name}-out6`,
        {
          routeTableId: routes.id,
          destinationIpv6CidrBlock: '::/0',
          gatewayId: this.ingw.id,
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

// no size because subnets are always /64s within a /56
export function nthSubnetV6(base: Output<string>, nth: number): Output<string> {
  return base.apply((base) => {
    // base looks like 2406:da1c:4a9:6600::/56
    //                 --- prefix -----^^   size
    //                                 ||------- /64 subnet goes here

    const parsed = base.match(/^(?<prefix>[0-9a-f:]+)00::\/56$/)?.groups;
    if (!parsed) throw new Error(`Invalid IPv6 CIDR block: ${base}`);
    const { prefix } = parsed!;

    const subnetPostfix = nth.toString(16).padStart(2, '0');
    return `${prefix}${subnetPostfix}::/64`;
  });
}

function subnetToOutput(block: SubnetBlock): SubnetOutput {
  return {
    id: block.subnet.id,
    zone: output(block.zone),
    v4Cidr: block.subnet.cidrBlock.apply((cidr) => cidr),
    v6Cidr: block.subnet.ipv6CidrBlock.apply((cidr) => cidr),
  };
}

// export interface NetworkOutputs {
//   vpc: Output<string>;
//   v4Cidr: Output<undefined | string>;
//   v6Cidr: Output<undefined | string>;
//   natSubnets: SubnetOutput[];
//   workloadSubnets: SubnetOutput[];
//   natSubnetIds: Output<string[]>;
//   workloadSubnetIds: Output<string[]>;
// }

export function fromStackReference(
  $stack: StackReference,
  key: string = 'network',
): Omit<NetworkOutputs, 'natSubnets' | 'workloadSubnets' | 'publicWorkloadSubnets'> {
  const network = $stack.getOutput(key);
  return {
    vpc: network.apply((n) => n.vpc as string),
    v4Cidr: network.apply((n) => n.v4Cidr as string),
    v6Cidr: network.apply((n) => n.v6Cidr as string),
    natSubnetIds: network.apply((n) => n.natSubnetIds as string[]),
    workloadSubnetIds: network.apply((n) => n.workloadSubnetIds as string[]),
    publicWorkloadSubnetIds: network.apply((n) => n.publicWorkloadSubnetIds as string[]),
  };
}
