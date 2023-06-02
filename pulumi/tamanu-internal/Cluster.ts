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
    super('pkg:index:Cluster', name, {}, opts);
    this.#name = name;
    this.#args = { numberOfFacilities: 2, ...args };
    this.#infra = new StackReference('bes/tamanu-infra/main', {}, { parent: this });

    this.#db = this.#infra.getOutput('cluster').apply((cluster) =>
      getDatabase({
        dbInstanceIdentifier: cluster.database as string,
      }),
    );
    const { databases, provisioner } = this.runDbProvisioner();

    const centralEndpoint = new Endpoint(
      'central',
      {
        clusterName: this.#name,
        infra: this.#infra,
      },
      { parent: this },
    );

    const facilityEnumerator = Array.from({ length: this.#args.numberOfFacilities }).map(
      (_, i) => i + 1,
    );

    const facilityCredentials = facilityEnumerator.map((index) => ({
      index,
      secret: new Secret(
        name,
        {
          secretValue: centralEndpoint.internal.apply((endpoint) => {
            return {
              centralUrl: `https://${endpoint}`,
              facilityId: `facility-${index}`,
              email: `facility-${index}@tamanu.io`,
              password: this.makePassword(`facility-${index}`),
            };
          }),
          namePrefix: `internal-facility-${this.#name}-`,
          description: `Sync credentials for Tamanu Internal deployment ${
            this.#name
          }, facility ${index}`,
        },
        { parent: this },
      ),
    }));

    new Server(
      'central',
      {
        endpoint: centralEndpoint,
        infra: this.#infra,
        clusterName: this.#name,
        imageName: 'central',
        imageTag: this.#args.imageTag,
        cores: 2,
        memoryGB: 2,
        configTemplate: 'configTemplates/central.json',
        dbSecret: databases.find((c) => c.name === `${name}-central`)!.secret,
        configuratorEnv: [
          {
            name: 'FACILITY_SECRETS',
            value: jsonStringify(facilityCredentials.map(({ secret }) => secret.outputs.arn)),
          },
          { name: 'REFERENCE_DATA_PATH', value: REFERENCE_DATA_PATH },
          { name: 'REFERENCE_DATA_BUCKET', value: this.#args.referenceData.bucket },
          { name: 'REFERENCE_DATA_KEYS', value: jsonStringify(this.#args.referenceData.files) },
          { name: 'TARGET_PROVISIONING_FILE', value: TARGET_PROVISIONING_FILE },
        ],
      },
      { parent: centralEndpoint, dependsOn: [provisioner] },
    );

    const facilities = facilityCredentials.map(({ index, secret }) => {
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
          dbSecret: databases.find((c) => c.name === `${name}-facility-${index}`)!.secret,
          configuratorEnv: [{ name: 'FACILITY_SECRET', value: secret.outputs.arn }],
        },
        { parent: endpoint, dependsOn: [provisioner] },
      );

      return [`facility${index}`, endpointOutput(endpoint)];
    });

    this.registerOutputs(
      (this.outputs = {
        facilityCount: this.#args.numberOfFacilities,
        services: {
          central: endpointOutput(centralEndpoint),
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

  databaseProvisionConfig(kind: string, index?: number): [Secret, DbProvisionerDatabase] {
    const name = [this.#name, kind, index].filter(Boolean).join('-');

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
            dbname: name,
            username: name,
            password,
          };
        }),
        namePrefix: `internal-db-${this.#name}-`,
        description: `PostgresSQL credentials for Tamanu Internal deployment ${
          this.#name
        }, ${kind} server ${index ?? ''}`,
      },
      { parent: this },
    );

    return [
      secret,
      {
        name,
        owner: name,
        secret: secret.outputs.arn,
        extensions: ['uuid-ossp'],
      },
    ];
  }

  runDbProvisioner() {
    const [secret, provisionConfig] = this.databaseProvisionConfig('central');
    const databases = [provisionConfig];
    const secrets = [secret];
    for (let i = 1; i <= this.#args.numberOfFacilities; i++) {
      const [secret, provisionConfig] = this.databaseProvisionConfig('facility', i);
      databases.push(provisionConfig);
      secrets.push(secret);
    }

    const dbProvisioner = this.#infra
      .getOutput('cluster')
      .apply((cluster) => cluster.provisioner as string);
    const dbProvisionerInput: DbProvisionerInput = { databases };
    const provisioner = new aws.lambda.Invocation(
      `${this.#name}-provisioner`,
      {
        functionName: dbProvisioner,
        input: jsonStringify(dbProvisionerInput),
      },
      { parent: this, dependsOn: secrets },
    );

    return { databases, provisioner };
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
