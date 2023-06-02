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
import { Secret } from './Secret';
// this form is required to import lambda as otherwise it creates a circular dependency error
import * as aws from '@pulumi/aws';
import { TamanuServer, TamanuServerOutputs } from './TamanuServer';

export interface TamanuClusterArgs {
  imageTag: string;
  referenceData: {
    bucket: string;
    files: string[];
  };

  /** @default 2 */
  numberOfFacilities?: number;
}

export interface TamanuClusterOutputs {
  facilityCount: number;
  services: {
    [name: string]: TamanuServerOutputs;
  };
}

export interface TamanuClusterServiceArgs {
  index?: number;
  cores?: number;
  memoryGB?: number;
  scale?: number;
  database?: string | false;
}

const TARGET_PROVISIONING_FILE = '/config/provisioning/central.json';
const REFERENCE_DATA_PATH = '/config/provisioning/refdata/';

export class TamanuCluster extends ComponentResource {
  #name: string;
  #args: Required<TamanuClusterArgs>;
  #infra: StackReference;

  outputs: TamanuClusterOutputs;

  #db: Output<GetInstanceResult>;

  constructor(name: string, args: TamanuClusterArgs, opts: ComponentResourceOptions = {}) {
    super('pkg:index:TamanuCluster', name, {}, opts);
    this.#name = name;
    this.#args = { numberOfFacilities: 2, ...args };
    this.#infra = new StackReference('bes/tamanu-infra/main', {}, { parent: this });

    this.#db = this.#infra.getOutput('cluster').apply((cluster) =>
      getDatabase({
        dbInstanceIdentifier: cluster.database as string,
      }),
    );

    const facilityEnumerator = Array.from({ length: this.#args.numberOfFacilities }).map(
      (_, i) => i + 1,
    );

    const { databases, provisioner } = this.runDbProvisioner();

    const central = new TamanuServer(
      'central',
      {
        clusterName: this.#name,
        imageName: 'central',
        imageTag: this.#args.imageTag,
        cores: 2,
        memoryGB: 2,
        configTemplate: 'configTemplates/central.json',
        dbSecret: databases.find((c) => c.name === `${name}-central`)!.secret,
        configuratorEnv: [
          { name: 'FACILITY_SECRETS', value: jsonStringify([]) },
          { name: 'REFERENCE_DATA_PATH', value: REFERENCE_DATA_PATH },
          { name: 'REFERENCE_DATA_BUCKET', value: this.#args.referenceData.bucket },
          { name: 'REFERENCE_DATA_KEYS', value: jsonStringify(this.#args.referenceData.files) },
          { name: 'TARGET_PROVISIONING_FILE', value: TARGET_PROVISIONING_FILE },
        ],
      },
      { parent: this, dependsOn: [provisioner] },
    );

    const facilities = facilityEnumerator.map(
      (index) =>
        new TamanuServer(
          `facility-${index}`,
          {
            clusterName: this.#name,
            imageName: 'facility',
            imageTag: this.#args.imageTag,
            cores: 2,
            memoryGB: 2,
            index,
            configTemplate: 'configTemplates/facility.json',
            dbSecret: databases.find((c) => c.name === `${name}-facility-${index}`)!.secret,
          },
          { parent: this, dependsOn: [provisioner] },
        ),
    );

    this.registerOutputs(
      (this.outputs = {
        facilityCount: this.#args.numberOfFacilities,
        services: {
          central: central.outputs,
          ...Object.fromEntries(
            facilities.map((facility) => [`facility${facility.index}`, facility.outputs]),
          ),
        },
      }),
    );
  }

  databaseProvisionConfig(kind: string, index?: number): [Secret, DbProvisionerDatabase] {
    const name = [this.#name, kind, index].filter(Boolean).join('-');

    // Make the secret deterministic from the db name and a per-stack salt,
    // so it doesn't change on every invocation but is still reasonable secure.
    // !! For production setups, this should be redone with e.g. Bitwarden. !!
    const cfg = new Config();
    const salt = cfg.requireSecret('salt');
    const password = salt.apply((salt) =>
      createHash('sha256').update(salt).update(name).digest('hex'),
    );

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
