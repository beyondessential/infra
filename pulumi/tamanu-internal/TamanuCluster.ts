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

    const { provisionConfig, provisioner } = this.runDbProvisioner();

    const central = new TamanuServer(
      'central',
      {
        clusterName: this.#name,
        imageName: 'central',
        imageTag: this.#args.imageTag,
        cores: 2,
        memoryGB: 4,
        configTemplate: 'configTemplates/central.json',
        dbCredentialArn: provisionConfig.find((c) => c.name === `${name}-central`)!
          .password_from_secret,
      },
      { parent: this, dependsOn: [provisioner] },
    );

    const facilities = Array.from({ length: this.#args.numberOfFacilities }).map(
      (_, i) =>
        new TamanuServer(
          `facility-${i + 1}`,
          {
            clusterName: this.#name,
            imageName: 'facility',
            imageTag: this.#args.imageTag,
            cores: 2,
            memoryGB: 2,
            index: i + 1,
            configTemplate: 'configTemplates/facility.json',
            dbCredentialArn: provisionConfig.find((c) => c.name === `${name}-facility-${i + 1}`)!
              .password_from_secret,
          },
          { parent: this, dependsOn: [provisioner] },
        ),
    );

    this.registerOutputs(
      (this.outputs = {
        facilityCount: this.#args.numberOfFacilities,
        services: {
          centralServer: central.outputs,
          ...Object.fromEntries(
            facilities.map((facility, i) => [`facility${i + 1}`, facility.outputs]),
          ),
        },
      }),
    );
  }

  databaseProvisionConfig(kind: string, index?: number): DbProvisionerDatabase {
    const name = [this.#name, kind, index].filter(Boolean).join('-');

    // Make the secret deterministic from the db name and a per-stack salt,
    // so it doesn't change on every invocation but is still reasonable secure.
    // !! For production setups, this should be redone with e.g. Bitwarden. !!
    const cfg = new Config();
    const salt = cfg.requireSecret('salt');
    const password = salt.apply((salt) =>
      createHash('sha256').update(salt).update(name).digest('hex'),
    );

    const secretMeta = new Secret(
      name,
      {
        secretValue: {
          // this structure makes this a rotatable secret
          engine: 'postgres',
          host: this.#db.endpoint,
          dbname: name,
          username: name,
          password,
        },
        namePrefix: `internal-db-${this.#name}-`,
        description: `PostgresSQL credentials for Tamanu Internal deployment ${
          this.#name
        }, ${kind} server ${index ?? ''}`,
      },
      { parent: this },
    );

    return {
      name,
      owner: name,
      password_from_secret: secretMeta.outputs.arn,
      extensions: ['uuid-ossp'],
    };
  }

  runDbProvisioner() {
    const provisionConfig = [this.databaseProvisionConfig('central')];
    for (let i = 1; i <= this.#args.numberOfFacilities; i++) {
      provisionConfig.push(this.databaseProvisionConfig('facility', i));
    }

    const dbProvisioner = this.#infra
      .getOutput('cluster')
      .apply((cluster) => cluster.provisioner as string);
    const dbProvisionerInput: DbProvisionerInput = {
      db_instance: {
        host: this.#db.endpoint,
        database: 'postgres',
        credential_from_secret: this.#db.masterUserSecrets.apply(
          (secrets: { secretArn: string }[]) => secrets[0].secretArn,
        ),
      },
      databases: provisionConfig,
    };

    const provisioner = new aws.lambda.Invocation(
      `${this.#name}-provisioner`,
      {
        functionName: dbProvisioner,
        input: jsonStringify(dbProvisionerInput),
      },
      { parent: this },
    );

    return { provisionConfig, provisioner };
  }
}

interface DbProvisionerInput {
  db_instance: DbProvisionerDbInstance;
  databases: DbProvisionerDatabase[];
}

// Admin access to the RDS instance
interface DbProvisionerDbInstance {
  host: Output<string>;
  database: string;

  // Secret ARN for the username+password
  credential_from_secret: Output<string>;
}

interface DbProvisionerDatabase {
  name: string;
  owner: string;

  // Secret ARN for the password
  password_from_secret: Output<string>;

  // PostgreSQL extensions to install
  extensions?: string[];
}
