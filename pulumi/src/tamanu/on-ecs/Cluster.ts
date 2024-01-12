import { createHash } from 'crypto';

import {
  ComponentResource,
  ComponentResourceOptions,
  Config,
  Output,
  StackReference,
  all,
  jsonStringify,
} from '@pulumi/pulumi';
import { Cluster as ECSCluster } from '@pulumi/aws/ecs/index.js';
import { getInstanceOutput as getDatabase, GetInstanceResult } from '@pulumi/aws/rds/index.js';
import { Database, Extension, GrantRole, Role } from '@pulumi/postgresql';

import { ValidCertificate } from '../../common/ValidCertificate.js';
import * as securityGroupRules from '../../common/securityGroupRules.js';
import { Secret } from '../../common/Secret.js';
import { Endpoint } from './Endpoint.js';
import { Server } from './Server.js';
import { SecurityGroup } from '@pulumi/aws/ec2/index.js';
import { LoadBalancer } from '../../common/LoadBalancer.js';
import { truncateDomainIfNeeded } from '../../common/dns.js';
import { Frontend } from './Frontend.js';
import { Router } from './Router.js';

export interface FacilityDef {
  facilityId: string;
  domain?: string;
  email?: string;
}

export interface ReferenceDataDef {
  bucket: string;
  files: string[];
}

export interface ClusterArgs {
  infraStack: string;
  imageTag: string;
  superdomain: string;
  ownLoadBalancer?: boolean;

  referenceData?: ReferenceDataDef | null;

  initialUsers?: {
    [email: string]: {
      email: string;
      password: string;
      role: string;
    };
  };

  facilities: FacilityDef[];

  /** Any extra tags to add to all resources. */
  tags?: { [key: string]: string };
}

export interface ClusterOutputs {
  services: {
    [name: string]: { database: Output<string>; url: Output<string> };
  };
}

export interface ClusterServiceArgs {
  index?: number;
  cores?: number;
  memoryGB?: number;
  scale?: number;
  database?: string | false;
}

const TARGET_PROVISIONING_FILE = '/config/provisioning/central.json';
const REFERENCE_DATA_PATH = '/config/provisioning/refdata/';
const REPOS_STACK = 'bes/tamanu-infra/main';

export class Cluster extends ComponentResource {
  #name: string;
  #args: Required<ClusterArgs>;
  #infra: StackReference;
  #repos: StackReference;

  outputs: ClusterOutputs;

  #salt: Output<string> = new Config().requireSecret('salt');
  #db: Output<GetInstanceResult>;

  #facilities: Required<FacilityDef>[];

  constructor(name: string, args: ClusterArgs, opts: ComponentResourceOptions = {}) {
    super('bes:tamanu:Cluster', name, {}, opts);
    this.#name = name;
    this.#args = {
      tags: {},
      initialUsers: {},
      referenceData: null,
      ownLoadBalancer: false,
      ...args,
    };

    this.#infra = new StackReference(this.#args.infraStack, {}, { parent: this });
    this.#repos =
      this.#args.infraStack === REPOS_STACK
        ? this.#infra
        : new StackReference(REPOS_STACK, {}, { parent: this });

    this.#args.tags.Application = 'Tamanu';
    this.#args.tags.Cluster = name;
    this.#args.tags.Infra = 'internal';

    this.#facilities = this.#args.facilities.map((f) => ({
      ...f,
      domain: f.domain ?? f.facilityId,
      email: `${f.facilityId}@tamanu.io`,
    }));

    const $cluster = this.#infra.getOutput('cluster');
    const $network = this.#infra.getOutput('network');

    this.#db = $cluster.apply((cluster) =>
      getDatabase({
        dbInstanceIdentifier: cluster.database.instance as string,
      }),
    );

    const ecs = new ECSCluster(
      `internal-${this.#name}`,
      {
        tags: this.#args.tags,
      },
      { parent: this },
    );

    const zoneId = $cluster.apply((cluster) => cluster.zone.id as string);
    const zoneName = $cluster.apply((cluster) => cluster.zone.name as string);
    const domainRoot = zoneName.apply((zoneName) =>
      truncateDomainIfNeeded(this.#args.superdomain, zoneName, true),
    );
    const truncatedSuperdomain = domainRoot.apply((root) => root.split('.')[0]);
    const domainNames = domainRoot.apply((root) => [
      root,
      truncateDomainIfNeeded('central', root),
      ...this.#facilities.map((f) => truncateDomainIfNeeded(f.domain, root)),
    ]);

    const { certificateArn } = new ValidCertificate(
      this.#name,
      {
        domainNames,
        zoneId,
        tags: this.#args.tags,
      },
      { parent: ecs },
    );

    const ownLb = this.#args.ownLoadBalancer
      ? new LoadBalancer(
          `${name}-lb`,
          {
            subnetIds: $network.apply((network) => network.natSubnetIds as string[]),
            securityGroupIds: [
              new SecurityGroup(
                `${name}-lb`,
                {
                  vpcId: $network.apply((network) => network.vpc as string),
                  description: `[LB] Custom Rules for ${this.#name}`,
                  ingress: [securityGroupRules.allICMPv4],
                  egress: [securityGroupRules.all],
                  tags: {
                    Name: `${this.#name}-lb`,
                    Purpose: 'lb',
                    ...this.#args.tags,
                  },
                },
                {
                  parent: this,
                  ignoreChanges: ['ingress', 'egress'],
                },
              ).id,
            ],
            defaultDnsName: domainNames.apply(([root]) => root),
            zoneId,
            certificateArn,
            tags: {
              Purpose: 'containers',
              ...this.#args.tags,
            },
          },
          { parent: this },
        )
      : null;

    const frontend = new Frontend(
      {
        ecs,
        infra: this.#infra,
        repos: this.#repos,
        clusterName: this.#name,
        imageName: 'frontend',
        imageTag: this.#args.imageTag,
        tags: {
          Service: 'frontend',
          ...this.#args.tags,
        },
      },
      { parent: this },
    );

    const central = {
      endpoint: new Endpoint(
        'central',
        {
          clusterName: this.#name,
          superdomain: truncatedSuperdomain,
          infra: this.#infra,
          certificateArn,
          lb: ownLb?.outputs,
          target: this.#args.ownLoadBalancer
            ? undefined
            : $cluster.apply((cluster) => cluster.lb.dnsCName as string),
          tags: this.#args.tags,
        },
        { parent: this },
      ),
      ...this.database(),
    };

    new Router(
      'central',
      {
        ecs,
        infra: this.#infra,
        repos: this.#repos,
        clusterName: this.#name,
        endpoint: central.endpoint,
        frontend,
        tags: {
          Service: 'central',
          ...this.#args.tags,
        },
      },
      { parent: this },
    );

    const facilityCredentials = this.#facilities.map((f) => {
      const name = `sync-${f.facilityId}`;
      const password = this.makePassword(name);

      return {
        ...f,
        ...this.database(f.facilityId),
        syncSecret: new Secret(
          name,
          {
            secretValue: central.endpoint.internal.apply((endpoint) => {
              return {
                centralUrl: `http://${endpoint}`,
                facilityId: f.facilityId,
                email: f.email,
                password,
              };
            }),
            namePrefix: `internal-${this.#name}`,
            description: `Sync credentials for Tamanu Internal deployment ${this.#name}, ${
              f.domain
            }`,
            tags: {
              Purpose: 'sync',
              ...this.#args.tags,
            },
          },
          { parent: this },
        ),
      };
    });

    const centralServer = new Server(
      'central',
      {
        ecs,
        endpoint: central.endpoint,
        infra: this.#infra,
        repos: this.#repos,
        clusterName: this.#name,
        imageName: 'central',
        imageTag: this.#args.imageTag,
        cores: 2,
        memoryGB: 4,
        configTemplate: 'configTemplates/central.json',
        dbSecret: central.dbSecret.outputs.arn,
        syncSecrets: facilityCredentials.map(({ syncSecret }) => syncSecret.outputs.arn),
        referenceDataBucket: this.#args.referenceData?.bucket,
        configuratorEnv: [
          {
            name: 'CANONICAL_HOSTNAME',
            value: central.endpoint.external.apply((url) => `https://${url}`),
          },
          {
            name: 'FACILITY_SECRETS',
            value: jsonStringify(
              facilityCredentials.map(({ syncSecret }) => syncSecret.outputs.arn),
            ),
          },
          ...(this.#args.referenceData
            ? [
                { name: 'REFERENCE_DATA_PATH', value: REFERENCE_DATA_PATH },
                { name: 'REFERENCE_DATA_BUCKET', value: this.#args.referenceData.bucket },
                {
                  name: 'REFERENCE_DATA_KEYS',
                  value: jsonStringify(this.#args.referenceData.files),
                },
              ]
            : []),
          { name: 'TARGET_PROVISIONING_FILE', value: TARGET_PROVISIONING_FILE },
          {
            name: 'USER_DEFINITIONS',
            value: jsonStringify({
              'admin@tamanu.io': {
                displayName: 'Initial Admin',
                password: 'admin',
                role: 'admin',
              },
              ...this.#args.initialUsers,
            }),
          },
        ],
        tags: {
          Service: 'central',
          ...this.#args.tags,
        },
      },
      { parent: central.endpoint },
    );

    const facilities = facilityCredentials.map(
      ({ facilityId, domain, dbSecret, dbName, syncSecret }) => {
        const endpoint = new Endpoint(
          facilityId,
          {
            domain,
            clusterName: this.#name,
            superdomain: truncatedSuperdomain,
            infra: this.#infra,
            certificateArn,
            lb: ownLb?.outputs,
            target: this.#args.ownLoadBalancer
              ? undefined
              : $cluster.apply((cluster) => cluster.lb.dnsCName as string),
          },
          { parent: this },
        );

        new Router(
          facilityId,
          {
            ecs,
            infra: this.#infra,
            repos: this.#repos,
            clusterName: this.#name,
            endpoint,
            frontend,
            tags: {
              Service: 'facility',
              ...this.#args.tags,
            },
          },
          { parent: this },
        );

        new Server(
          facilityId,
          {
            ecs,
            endpoint,
            infra: this.#infra,
            repos: this.#repos,
            clusterName: this.#name,
            imageName: 'facility',
            imageTag: this.#args.imageTag,
            cores: 1,
            memoryGB: 2,
            facilityId,
            configTemplate: 'configTemplates/facility.json',
            dbSecret: dbSecret.outputs.arn,
            syncSecrets: [syncSecret.outputs.arn],
            configuratorEnv: [{ name: 'FACILITY_SECRET', value: syncSecret.outputs.arn }],
            tags: {
              Service: 'facility',
              ...this.#args.tags,
            },
          },
          { parent: endpoint, dependsOn: [centralServer] },
        );

        return {
          facilityId,
          endpoint,
          url: endpoint.external.apply((external) => `https://${external}`),
          database: dbName,
        };
      },
    );

    this.registerOutputs(
      (this.outputs = {
        services: {
          central: {
            url: central.endpoint.external.apply((external) => `https://${external}`),
            database: central.dbName,
          },
          ...Object.fromEntries(
            facilities.map(({ facilityId, url, database }) => [facilityId, { url, database }]),
          ),
        },
      }),
    );
  }

  // Make secrets deterministic so they don't change on every invocation
  // but are still reasonable secure.
  makePassword(seed: string) {
    return this.#salt.apply((salt) => createHash('sha256').update(salt).update(seed).digest('hex'));
  }

  database(facilityId?: string): { dbSecret: Secret; dbName: Output<string> } {
    const name = facilityId ? `${this.#name}-${facilityId}` : `${this.#name}-central`;
    const dbSecretName = facilityId ? `db-${facilityId}` : 'db-central';
    const password = this.makePassword(dbSecretName);

    const role = new Role(
      name,
      {
        login: true,
        password,
      },
      { parent: this },
    );

    // Needed for the postgres user to be able to access the database
    const grant = new GrantRole(
      `${name}-postgres-grant`,
      {
        role: 'postgres',
        grantRole: role.name,
      },
      { parent: role },
    );

    const db = new Database(
      name,
      {
        owner: role.name,
      },
      {
        parent: role,
        // so that the grant is not dropped before the database (which would cause an error)
        dependsOn: [grant],
      },
    );

    new Extension(
      `${name}-uuid-ossp`,
      {
        database: db.name,
        name: 'uuid-ossp',
        dropCascade: true,
      },
      { parent: db },
    );

    const secret = new Secret(
      dbSecretName,
      {
        secretValue: all([this.#db.endpoint, db]).apply(([endpoint, db]) => {
          const [host, port] = endpoint.split(':');
          return {
            // this structure makes this a rotatable secret
            // (though we don't actually rotate it yet)
            engine: 'postgres',
            host,
            port: +port,
            dbname: db.name,
            username: role.name,
            password,
          };
        }),
        namePrefix: `internal-${this.#name}`,
        description: `PostgresSQL credentials for Tamanu Internal deployment ${this.#name}, ${
          facilityId ?? 'central'
        } server`,
        tags: {
          Purpose: 'database',
          ...this.#args.tags,
        },
      },
      {
        parent: role,
      },
    );

    return {
      dbSecret: secret,
      dbName: db.name,
    };
  }
}
