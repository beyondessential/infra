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

  /** @default 2 */
  numberOfFacilities?: number;

  /** Any extra tags to add to all resources. */
  tags?: { [key: string]: string };
}

export interface ClusterOutputs {
  facilityCount: number;
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

  constructor(name: string, args: ClusterArgs, opts: ComponentResourceOptions = {}) {
    super('bes:tamanu:Cluster', name, {}, opts);
    this.#name = name;
    this.#args = { numberOfFacilities: 2, tags: {}, initialUsers: {}, ...args };
    this.#infra = new StackReference('bes/tamanu-infra/main', {}, { parent: this });
    this.#args.tags.Application = 'Tamanu';
    this.#args.tags.Cluster = name;
    this.#args.tags.Infra = 'internal';

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

    const facilityEnumerator = Array.from({ length: this.#args.numberOfFacilities }).map(
      (_, i) => i + 1,
    );

    const zoneId = this.#infra.getOutput('cluster').apply((cluster) => cluster.zone.id as string);
    const zoneName = this.#infra
      .getOutput('cluster')
      .apply((cluster) => cluster.zone.name as string);
    const { certificateArn } = new ValidCertificate(
      this.#name,
      {
        domainNames: zoneName.apply((zoneName) =>
          ['central', ...facilityEnumerator.map((index) => `facility-${index}`)].map(
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

    const facilityCredentials = facilityEnumerator.map((index) => {
      const name = this.secretName('facility', 'sync', index);
      const password = this.makePassword(name);

      return {
        index,
        ...this.database('facility', index),
        syncSecret: new Secret(
          name,
          {
            secretValue: central.endpoint.internal.apply((endpoint) => {
              return {
                centralUrl: `http://${endpoint}`,
                facilityId: `facility-${index}`,
                email: `facility-${index}@tamanu.io`,
                password,
              };
            }),
            namePrefix: `internal-${this.#name}`,
            description: `Sync credentials for Tamanu Internal deployment ${
              this.#name
            }, facility ${index}`,
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

    const facilities = facilityCredentials.map(({ index, dbSecret, dbName, syncSecret }) => {
      const endpoint = new Endpoint(
        `facility-${index}`,
        {
          clusterName: this.#name,
          infra: this.#infra,
          certificateArn,
        },
        { parent: this },
      );

      new Server(
        `facility-${index}`,
        {
          ecs,
          endpoint,
          infra: this.#infra,
          clusterName: this.#name,
          imageName: 'facility',
          imageTag: this.#args.imageTag,
          cores: 1,
          memoryGB: 2,
          index,
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
        `facility${index}`,
        {
          url: endpoint.external.apply((external) => `https://${external}`),
          database: dbName,
        },
      ];
    });

    this.registerOutputs(
      (this.outputs = {
        facilityCount: this.#args.numberOfFacilities,
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

  secretName(serverKind: string, secretKind: string, index?: number) {
    return [secretKind, serverKind, index].filter(Boolean).join('-');
  }

  database(kind: string, index?: number): { dbSecret: Secret; dbName: Output<string> } {
    const name = [this.#name, kind, index].filter(Boolean).join('-');
    const secretName = this.secretName(kind, 'db', index);
    const password = this.makePassword(secretName);

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
      secretName,
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
        description: `PostgresSQL credentials for Tamanu Internal deployment ${
          this.#name
        }, ${kind} server ${index ?? ''}`,
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
