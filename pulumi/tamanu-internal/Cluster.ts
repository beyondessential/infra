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
import { Cluster as ECSCluster } from '@pulumi/aws/ecs';
import { getInstanceOutput as getDatabase, GetInstanceResult } from '@pulumi/aws/rds';
import { Database, Extension, GrantRole, Role } from '@pulumi/postgresql';

import { ValidCertificate } from '../ValidCertificate';
import { Secret } from './Secret';
import { Endpoint } from './Endpoint';
import { Server } from './Server';

export interface FacilityDef {
  facilityId: string;
  domain?: string;
  email?: string;
}

export interface ClusterArgs {
  imageTag: string;
  referenceData: {
    bucket: string;
    files: string[];
  };

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

export class Cluster extends ComponentResource {
  #name: string;
  #args: Required<ClusterArgs>;
  #infra: StackReference;

  outputs: ClusterOutputs;

  #salt: Output<string> = new Config().requireSecret('salt');
  #db: Output<GetInstanceResult>;

  #facilities: Required<FacilityDef>[];

  constructor(name: string, args: ClusterArgs, opts: ComponentResourceOptions = {}) {
    super('bes:tamanu:Cluster', name, {}, opts);
    this.#name = name;
    this.#args = { tags: {}, initialUsers: {}, ...args };
    this.#infra = new StackReference('bes/tamanu-infra/main', {}, { parent: this });
    this.#args.tags.Application = 'Tamanu';
    this.#args.tags.Cluster = name;
    this.#args.tags.Infra = 'internal';
    this.#facilities = this.#args.facilities.map((f) => ({
      ...f,
      domain: f.domain ?? f.facilityId,
      email: `${f.facilityId}@tamanu.io`,
    }));

    this.#db = this.#infra.getOutput('cluster').apply((cluster) =>
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

    const zoneId = this.#infra.getOutput('cluster').apply((cluster) => cluster.zone.id as string);
    const zoneName = this.#infra
      .getOutput('cluster')
      .apply((cluster) => cluster.zone.name as string);
    const { certificateArn } = new ValidCertificate(
      this.#name,
      {
        domainNames: zoneName.apply((zoneName) =>
          ['central', ...this.#facilities.map((f) => f.domain)].map(
            (name) => `${name}.${this.#name}.${zoneName}`,
          ),
        ),
        zoneId,
        tags: this.#args.tags,
      },
      { parent: ecs },
    );

    const central = {
      endpoint: new Endpoint(
        'central',
        {
          clusterName: this.#name,
          infra: this.#infra,
          certificateArn,
          tags: this.#args.tags,
        },
        { parent: this },
      ),
      ...this.database('central'),
    };

    const facilityCredentials = this.#facilities.map((f) => {
      const name = `sync-${f.facilityId}`;
      const password = this.makePassword(name);

      return {
        ...f,
        ...this.database('facility', f.facilityId),
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
        clusterName: this.#name,
        imageName: 'central',
        imageTag: this.#args.imageTag,
        cores: 2,
        memoryGB: 4,
        configTemplate: 'configTemplates/central.json',
        dbSecret: central.dbSecret.outputs.arn,
        syncSecrets: facilityCredentials.map(({ syncSecret }) => syncSecret.outputs.arn),
        referenceDataBucket: this.#args.referenceData.bucket,
        configuratorEnv: [
          {
            name: 'FACILITY_SECRETS',
            value: jsonStringify(
              facilityCredentials.map(({ syncSecret }) => syncSecret.outputs.arn),
            ),
          },
          { name: 'REFERENCE_DATA_PATH', value: REFERENCE_DATA_PATH },
          { name: 'REFERENCE_DATA_BUCKET', value: this.#args.referenceData.bucket },
          { name: 'REFERENCE_DATA_KEYS', value: jsonStringify(this.#args.referenceData.files) },
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
            infra: this.#infra,
            certificateArn,
          },
          { parent: this },
        );

        new Server(
          facilityId,
          {
            ecs,
            endpoint,
            infra: this.#infra,
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

        return [
          facilityId,
          {
            url: endpoint.external.apply((external) => `https://${external}`),
            database: dbName,
          },
        ];
      },
    );

    this.registerOutputs(
      (this.outputs = {
        services: {
          central: {
            url: central.endpoint.external.apply((external) => `https://${external}`),
            database: central.dbName,
          },
          ...Object.fromEntries(facilities),
        },
      }),
    );
  }

  // Make secrets deterministic so they don't change on every invocation
  // but are still reasonable secure.
  makePassword(seed: string) {
    return this.#salt.apply((salt) => createHash('sha256').update(salt).update(seed).digest('hex'));
  }

  database(kind: string, facilityId?: string): { dbSecret: Secret; dbName: Output<string> } {
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
