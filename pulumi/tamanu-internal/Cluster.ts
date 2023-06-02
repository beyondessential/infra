import { createHash } from 'crypto';

import {
  ComponentResource,
  ComponentResourceOptions,
  Config,
  Output,
  StackReference,
  jsonStringify,
} from '@pulumi/pulumi';
import { getInstanceOutput as getDatabase, GetInstanceResult } from '@pulumi/aws/rds';

// this form is required to import lambda as otherwise it creates a circular dependency error
import * as aws from '@pulumi/aws';

import { Secret } from './Secret';
import { Endpoint } from './Endpoint';
import { Server } from './Server';

export interface ClusterArgs {
  imageTag: string;
  referenceData: {
    bucket: string;
    files: string[];
  };

  /** @default 2 */
  numberOfFacilities?: number;
}

export interface ClusterOutputs {
  facilityCount: number;
  services: {
    [name: string]: ServiceEndpoints;
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
    super('pkg:index:TamanuCluster', name, {}, opts);
    this.#name = name;
    this.#args = { numberOfFacilities: 2, ...args };
    this.#infra = new StackReference('bes/tamanu-infra/main', {}, { parent: this });

    this.#db = this.#infra.getOutput('cluster').apply((cluster) =>
      getDatabase({
        dbInstanceIdentifier: cluster.database as string,
      }),
    );

    const central = {
      endpoint: new Endpoint(
        'central',
        {
          clusterName: this.#name,
          infra: this.#infra,
        },
        { parent: this },
      ),
      ...this.databaseProvisionConfig('central'),
    };

    const facilityEnumerator = Array.from({ length: this.#args.numberOfFacilities }).map(
      (_, i) => i + 1,
    );

    const facilityCredentials = facilityEnumerator.map((index) => {
      const name = this.secretName('facility', 'sync', index);
      const password = this.makePassword(name);

      return {
        index,
        ...this.databaseProvisionConfig('facility', index),
        syncSecret: new Secret(
          name,
          {
            secretValue: central.endpoint.internal.apply((endpoint) => {
              return {
                centralUrl: `https://${endpoint}`,
                facilityId: `facility-${index}`,
                email: `facility-${index}@tamanu.io`,
                password,
              };
            }),
            namePrefix: `internal-${this.#name}`,
            description: `Sync credentials for Tamanu Internal deployment ${
              this.#name
            }, facility ${index}`,
          },
          { parent: this },
        ),
      };
    });

    const dbProvisioner = this.runDbProvisioner([
      { dbSecret: central.dbSecret, dbConfig: central.dbConfig },
      ...facilityCredentials.map(({ dbSecret, dbConfig }) => ({ dbSecret, dbConfig })),
    ]);

    const centralServer = new Server(
      'central',
      {
        endpoint: central.endpoint,
        infra: this.#infra,
        clusterName: this.#name,
        imageName: 'central',
        imageTag: this.#args.imageTag,
        cores: 2,
        memoryGB: 2,
        configTemplate: 'configTemplates/central.json',
        dbSecret: central.dbSecret.outputs.arn,
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
        ],
      },
      { parent: central.endpoint, dependsOn: [dbProvisioner] },
    );

    const facilities = facilityCredentials.map(({ index, dbSecret, syncSecret }) => {
      const endpoint = new Endpoint(
        `facility-${index}`,
        {
          clusterName: this.#name,
          infra: this.#infra,
        },
        { parent: this },
      );

      new Server(
        `facility-${index}`,
        {
          endpoint,
          infra: this.#infra,
          clusterName: this.#name,
          imageName: 'facility',
          imageTag: this.#args.imageTag,
          cores: 2,
          memoryGB: 2,
          index,
          configTemplate: 'configTemplates/facility.json',
          dbSecret: dbSecret.outputs.arn,
          configuratorEnv: [{ name: 'FACILITY_SECRET', value: syncSecret.outputs.arn }],
        },
        { parent: endpoint, dependsOn: [dbProvisioner, centralServer] },
      );

      return [`facility${index}`, endpointOutput(endpoint)];
    });

    this.registerOutputs(
      (this.outputs = {
        facilityCount: this.#args.numberOfFacilities,
        services: {
          central: endpointOutput(central.endpoint),
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

  databaseProvisionConfig(
    kind: string,
    index?: number,
  ): { dbSecret: Secret; dbConfig: DbProvisionerDatabase } {
    const dbname = [kind, index].filter(Boolean).join('-');
    const name = this.secretName(kind, 'db', index);
    const password = this.makePassword(name);

    const secret = new Secret(
      name,
      {
        secretValue: this.#db.endpoint.apply((endpoint) => {
          const [host, port] = endpoint.split(':');
          return {
            // this structure makes this a rotatable secret
            engine: 'postgres',
            host,
            port: +port,
            dbname,
            username: dbname,
            password,
          };
        }),
        namePrefix: `internal-${this.#name}`,
        description: `PostgresSQL credentials for Tamanu Internal deployment ${
          this.#name
        }, ${kind} server ${index ?? ''}`,
      },
      { parent: this },
    );

    return {
      dbSecret: secret,
      dbConfig: {
        name,
        owner: name,
        secret: secret.outputs.arn,
        extensions: ['uuid-ossp'],
      },
    };
  }

  runDbProvisioner(databases: { dbSecret: Secret; dbConfig: DbProvisionerDatabase }[]) {
    const dbProvisioner = this.#infra
      .getOutput('cluster')
      .apply((cluster) => cluster.provisioner as string);
    const dbProvisionerInput: DbProvisionerInput = {
      databases: databases.map(({ dbConfig }) => dbConfig),
    };

    return new aws.lambda.Invocation(
      `${this.#name}-provisioner`,
      {
        functionName: dbProvisioner,
        input: jsonStringify(dbProvisionerInput),
      },
      { parent: this, dependsOn: databases.map(({ dbSecret }) => dbSecret) },
    );
  }
}

interface DbProvisionerInput {
  databases: DbProvisionerDatabase[];
}

interface DbProvisionerDatabase {
  name: string;
  owner: string;

  // Secret ARN for the password
  secret: Output<string>;

  // PostgreSQL extensions to install
  extensions?: string[];
}

interface ServiceEndpoints {
  internal: Output<string>;
  external: Output<string>;
}

function endpointOutput(endpoint: Endpoint): ServiceEndpoints {
  return {
    internal: endpoint.internal,
    external: endpoint.external,
  };
}
