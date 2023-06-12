import { readFileSync } from 'fs';

import { ComponentResource, ComponentResourceOptions, Output, all, secret } from '@pulumi/pulumi';
import { Instance, SecurityGroup, getAmiOutput } from '@pulumi/aws/ec2';
import { Instance as DBInstance, SubnetGroup } from '@pulumi/aws/rds';
import { Listener, LoadBalancer } from '@pulumi/aws/lb';
import { PrivateDnsNamespace } from '@pulumi/aws/servicediscovery';
import { DeviceKey, TailnetKey } from '@pulumi/tailscale';
import { getDeviceOutput } from '@pulumi/tailscale/getDevice';
import { Record, getZone } from '@pulumi/aws/route53';

import { Network, NetworkOutputs } from './Network';
import { RustLambda } from './RustLambda';
import { ValidCertificate } from '../ValidCertificate';

export interface ClusterInfraArgs {
  network: Network | NetworkOutputs;

  /** ID or Name of the public hosted zone for this cluster. */
  zone: string;

  /** Any extra tags to add to all resources. */
  tags?: { [key: string]: string };
}

export interface ClusterInfraOutputs {
  database: {
    instance: Output<string>;
    manager: Output<string>;
    endpoint: Output<string>;
  };
  containers: {
    securityGroup: Output<string>;
    namespaceId: Output<string>;
    namespaceName: Output<string>;
    loadbalancer: Output<string>;
  };
  lb: {
    arn: Output<string>;
    dnsName: Output<string>;
    listener: Output<string>;
  };
  zone: {
    id: Output<string>;
    name: Output<string>;
  };
}

export class ClusterInfra extends ComponentResource {
  #name: string;
  #network: NetworkOutputs;
  #args: Omit<Required<ClusterInfraArgs>, 'network'>;

  #cloudmap: PrivateDnsNamespace;
  #database: DBInstance;
  #zone: Output<{ id: string; name: string }>;
  #lb: LoadBalancer;
  #securityGroups: { [key: string]: SecurityGroup };

  outputs: ClusterInfraOutputs;

  constructor(
    name: string,
    { network, ...args }: ClusterInfraArgs,
    opts: ComponentResourceOptions = {},
  ) {
    super('bes:tamanu:ClusterInfra', name, {}, opts);
    this.#name = name;
    this.#network = network instanceof Network ? network.outputs : network;
    this.#args = {
      tags: {},
      ...args,
    };
    this.#args.tags.Infra = name;

    // Security groups
    this.#securityGroups = this.securityGroups();

    this.#cloudmap = new PrivateDnsNamespace(
      this.#name,
      {
        name: `${this.#name}.tamanu.bes`,
        vpc: this.#network.vpc,
        tags: this.#args.tags,
      },
      { parent: this },
    );

    this.#zone = all([
      getZone({
        zoneId: this.#args.zone,
      }).catch((idErr: Error) =>
        getZone({
          name: this.#args.zone,
        }).catch((nameErr: Error) => {
          throw new Error(`Could not find zone by ID or name:\n${idErr}\n${nameErr}`);
        }),
      ),
    ]).apply(([zone]) => ({
      id: zone.zoneId,
      name: zone.name,
    }));

    // Application LB across zones for API and Web public access to containers.
    const { lb, https } = this.loadBalancer();
    this.#lb = lb;

    // Single common database for all Tamanu clusters
    // Obviously this would be bad for production but for internal use it's good:
    // cheaper in aggregate, and tons faster to boot a new cluster.
    this.#database = this.database();

    // Tailscale-only jumpbox for within-VPC access for ops,
    // and for external access to the database for devs/testers.
    this.jumpBox();

    this.registerOutputs(
      (this.outputs = {
        database: {
          instance: this.#database.arn,
          manager: this.dbManager().name.apply((name) => name!),
          endpoint: this.#database.endpoint,
        },
        containers: {
          securityGroup: this.#securityGroups.containers.id,
          namespaceId: this.#cloudmap.id,
          namespaceName: this.#cloudmap.name,
          loadbalancer: this.#lb.arn,
        },
        lb: {
          arn: this.#lb.arn,
          dnsName: this.#lb.dnsName,
          listener: https.arn,
        },
        zone: this.#zone,
      }),
    );
  }

  securityGroups() {
    const all = {
      fromPort: 0,
      toPort: 0,
      protocol: '-1',
      cidrBlocks: ['0.0.0.0/0'],
    };
    const allICMPv4 = {
      fromPort: -1,
      toPort: -1,
      cidrBlocks: ['0.0.0.0/0'],
      description: 'ICMPv4',
      protocol: '1',
    };
    const openPort = (description: string, port: number, protocol: string = 'tcp') => ({
      description,
      fromPort: port,
      toPort: port,
      protocol,
      cidrBlocks: ['0.0.0.0/0'],
    });
    const openVpcPort = (description: string, port: number, protocol: string = 'tcp') => ({
      ...openPort(description, port, protocol),
      description: `${description} from VPC`,
      cidrBlocks: [this.#network.v4Cidr],
    });

    const databases = new SecurityGroup(
      `${this.#name}-databases`,
      {
        vpcId: this.#network.vpc,
        ingress: [openVpcPort('Postgres', 5432)],
        egress: [all],
        tags: {
          Name: `${this.#name}-databases`,
          Purpose: 'database',
          ...this.#args.tags,
        },
      },
      {
        parent: this,
      },
    );

    const containers = new SecurityGroup(
      `${this.#name}-containers`,
      {
        vpcId: this.#network.vpc,
        ingress: [
          allICMPv4,
          openPort('SSH', 22),
          openPort('HTTP', 80),
          openPort('Internal HTTP', 3000),
          openPort('HTTPS', 443),
          openPort('HTTP/3', 443, 'udp'),
        ],
        egress: [all],
        tags: {
          Name: `${this.#name}-containers`,
          Purpose: 'containers',
          ...this.#args.tags,
        },
      },
      {
        parent: this,
      },
    );

    const dbManager = new SecurityGroup(
      `${this.#name}-db-manager`,
      {
        vpcId: this.#network.vpc,
        ingress: [],
        egress: [all],
        tags: {
          Name: `${this.#name}-manager`,
          Purpose: 'db-manager',
          ...this.#args.tags,
        },
      },
      {
        parent: this,
      },
    );

    const jumpbox = new SecurityGroup(
      `${this.#name}-jumpbox`,
      {
        vpcId: this.#network.vpc,
        ingress: [],
        egress: [all],
        tags: {
          Name: `${this.#name}-jumpbox`,
          Purpose: 'jumpbox',
          ...this.#args.tags,
        },
      },
      {
        parent: this,
      },
    );

    const lb = new SecurityGroup(
      `${this.#name}-lb`,
      {
        vpcId: this.#network.vpc,
        ingress: [allICMPv4, openPort('HTTP', 80), openPort('HTTPS', 443)],
        egress: [all],
        tags: {
          Name: `${this.#name}-lb`,
          Purpose: 'lb',
          ...this.#args.tags,
        },
      },
      {
        parent: this,
      },
    );

    return { databases, containers, dbManager, jumpbox, lb };
  }

  database() {
    const subnetGroup = new SubnetGroup(
      this.#name,
      {
        subnetIds: this.#network.workloadSubnetIds,
        tags: {
          Name: `${this.#name}-database`,
          Purpose: 'database',
          ...this.#args.tags,
        },
      },
      {
        parent: this,
      },
    );

    const rds = new DBInstance(
      this.#name,
      {
        allocatedStorage: 20,
        maxAllocatedStorage: 100,
        autoMinorVersionUpgrade: true,
        dbSubnetGroupName: subnetGroup.name,
        engine: 'postgres',
        engineVersion: '14.6',
        instanceClass: 'db.t4g.medium', // ARM64
        manageMasterUserPassword: true,
        networkType: 'IPV4', // FIXME: DUAL
        performanceInsightsEnabled: true, // DISABLE WHEN DEVING: adds two minutes to the boot/create time
        publiclyAccessible: false,
        skipFinalSnapshot: true, // FIXME: configure final snapshot
        storageType: 'gp3',
        username: 'postgres',
        vpcSecurityGroupIds: [this.#securityGroups.databases.id],
      },
      {
        parent: this,
      },
    );

    return rds;
  }

  dbManager() {
    return new RustLambda(
      `${this.#name}-db-manager`,
      {
        source: '../../glue/db-manager',
        description: 'Manage databases and users for an RDS instance',
        timeoutSec: 300,
        environment: all([this.#database.endpoint, this.#database.masterUserSecrets]).apply(
          ([endpoint, secrets]) => ({
            PGHOST: endpoint.split(':')[0],
            PGPORT: endpoint.split(':')[1] ?? '5432',
            DB_SECRET: secrets[0].secretArn,
          }),
        ),
        network: {
          subnetIds: this.#network.workloadSubnetIds,
          securityGroupIds: [this.#securityGroups.dbManager.id],
        },
        policies: [
          {
            // policy to allow reading the db "master" secret(s)
            name: 'getdbmastersecret',
            policy: {
              Version: '2012-10-17',
              Statement: [
                {
                  Effect: 'Allow',
                  Action: ['secretsmanager:GetSecretValue'],
                  Resource: this.#database.masterUserSecrets.apply((secrets) =>
                    secrets.map((secret) => secret.secretArn),
                  ),
                },
              ],
            },
          },
          {
            // policy to allow reading managed db secrets for this cluster
            name: 'getdbsecrets',
            policy: {
              Version: '2012-10-17',
              Statement: [
                {
                  Effect: 'Allow',
                  Action: ['secretsmanager:GetSecretValue'],
                  Resource: `arn:aws:secretsmanager:ap-southeast-2:*:secret:${this.#name}-*-db-*`,
                },
              ],
            },
          },
        ],
        tags: { Purpose: 'db-manager', ...this.#args.tags },
      },
      { parent: this },
    );
  }

  loadBalancer() {
    const name = `${this.#name.startsWith('internal') ? `tamanu-${this.#name}` : this.#name}-http`;
    const lb = new LoadBalancer(
      // Workaround for LB names being forbidden from starting with internal-
      name,
      {
        internal: false,
        loadBalancerType: 'application',
        subnets: this.#network.natSubnetIds,
        ipAddressType: 'ipv4',
        securityGroups: [this.#securityGroups.lb.id],
        tags: {
          Purpose: 'containers',
          ...this.#args.tags,
        },
      },
      { parent: this },
    );

    // http->https redirect
    new Listener(
      `${name}-httpredirect`,
      {
        loadBalancerArn: lb.arn,
        port: 80,
        protocol: 'HTTP',
        defaultActions: [
          {
            type: 'redirect',
            redirect: {
              port: '443',
              protocol: 'HTTPS',
              statusCode: 'HTTP_301',
            },
          },
        ],
      },
      { parent: lb },
    );

    const certificate = new ValidCertificate(
      `${name}-default`,
      {
        domainNames: [this.#zone.name],
        zoneId: this.#zone.id,
      },
      { parent: lb },
    );

    // https termination
    const https = new Listener(
      `${name}-https`,
      {
        loadBalancerArn: lb.arn,
        port: 443,
        protocol: 'HTTPS',
        certificateArn: certificate.certificateArn,
        sslPolicy: 'ELBSecurityPolicy-TLS13-1-2-2021-06',
        defaultActions: [
          {
            type: 'fixed-response',
            fixedResponse: {
              contentType: 'text/plain',
              messageBody: `Tamanu ${this.#name}`,
              statusCode: '200',
            },
          },
        ],
      },
      { parent: lb },
    );

    new Record(
      `${name}-default`,
      {
        zoneId: this.#zone.id,
        name: this.#zone.name,
        type: 'A',
        aliases: [
          {
            name: lb.dnsName,
            zoneId: lb.zoneId,
            evaluateTargetHealth: true,
          },
        ],
      },
      { parent: lb },
    );

    return { lb, https };
  }

  jumpBox() {
    const alpine = getAmiOutput({
      mostRecent: true,
      filters: [
        {
          name: 'name',
          values: ['alpine-3.*-aarch64-uefi-tiny-r0'],
          // tiny = https://gitlab.alpinelinux.org/alpine/cloud/tiny-cloud
        },
        {
          name: 'virtualization-type',
          values: ['hvm'],
        },
      ],
      owners: ['538276064493'], // official Alpine images
    });

    const name = `${this.#name}-jumpbox`;
    const tailscaleName = `tamanu-${this.#name}-jumpbox`;

    const authKey = new TailnetKey(
      name,
      {
        ephemeral: false,

        // 5 minutes is fine when starting from where the VPC is up, but
        // if we're starting from scratch, we want more like 10 to 15.
        expiry: 15 * 60,

        reusable: false, // single-use
        preauthorized: true, // no need to approve manually

        // apply those on the device on creation
        tags: ['tag:infra', 'tag:infra-dbproxy'],
      },
      { parent: this },
    );

    // If you need to recreate the jumpbox without destroying the rest of the stack,
    // you'll need to manually terminate the jumpbox EC2 instance, remove the device
    // from Tailscale, and delete the TailnetKey (and dependents) from the Pulumi state.

    const box = new Instance(
      name,
      {
        keyName: 'ops',
        ami: alpine.id,
        instanceType: 't4g.nano',
        rootBlockDevice: {
          volumeSize: 1,
        },
        subnetId: this.#network.workloadSubnetIds[0],
        vpcSecurityGroupIds: [this.#securityGroups.jumpbox.id],

        // Changes to the script or to the db endpoint will _not_ cause the box to be replaced,
        // and will _not_ cause the script to be re-run. If you need to, either manually delete
        // as explained above, or make the changes yourself via SSH.
        userData: all([this.#database.endpoint, authKey.key]).apply(([endpoint, key]) =>
          secret(
            readFileSync('jumpbox-init.sh', 'utf-8')
              .replace(/%DB_ENDPOINT%/g, endpoint)
              .replace(/%TAILSCALE_AUTH_KEY%/g, key)
              .replace(/%TAILSCALE_NAME%/g, tailscaleName),
          ),
        ),
        tags: {
          Name: name,
          Purpose: 'jumpbox',
          ...this.#args.tags,
        },
      },
      { parent: authKey },
    );

    const tailscaleDevice = getDeviceOutput({
      // bind to the box, even if we don't use any of the outputs
      // the suffix here is the MagicDNS domain for our tailnet
      name: box.arn.apply((_) => `${tailscaleName}.tail53aef.ts.net`),
      waitFor: '15m',
    });

    // Disable device key expiry so we don't have to attend to the box.
    // this is different from the TailnetKey expiry, which must be kept short
    new DeviceKey(
      name,
      {
        deviceId: tailscaleDevice.id,
        keyExpiryDisabled: true,
      },
      { parent: authKey },
    );

    return box;
  }
}
