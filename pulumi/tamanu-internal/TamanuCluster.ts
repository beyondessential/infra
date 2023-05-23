import { createHash } from 'crypto';
import {
  ComponentResource,
  ComponentResourceOptions,
  Config,
  Output,
  StackReference,
  jsonStringify,
} from '@pulumi/pulumi';
import { Instance as DBInstance } from '@pulumi/aws/rds';
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
  database: Output<string>;
  databaseEndpoint: Output<string>;
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

  #db: DBInstance;

  constructor(name: string, args: TamanuClusterArgs, opts: ComponentResourceOptions = {}) {
    super('pkg:index:TamanuCluster', name, {}, opts);
    this.#name = name;
    this.#args = { numberOfFacilities: 2, ...args };
    this.#infra = new StackReference('bes/tamanu-infra/main', {}, { parent: this });

    this.#db = this.setupRds();
    this.runDbProvisioner();

    const central = new TamanuServer(
      `${this.#name}-central`,
      {
        imageName: 'central',
        imageTag: this.#args.imageTag,
        cores: 2,
        memoryGB: 4,
      },
      { parent: this },
    );
    // const facilities = Array.from({ length: this.#args.numberOfFacilities }).map((_, i) =>
    //   new TamanuServer(`${this.#name}-central`, {
    //     imageName: 'facility',
    //     imageTag: this.#args.imageTag,
    //     cores: 2,
    //     memoryGB: 2,
    //     index: i + 1,
    //   }, { parent: this })
    // );

    this.registerOutputs(
      (this.outputs = {
        database: this.#db.arn,
        databaseEndpoint: this.#db.endpoint,
        facilityCount: this.#args.numberOfFacilities,
        services: {
          // meta: meta.service.id,
          centralServer: central.outputs,
          // ...Object.fromEntries(
          //   facilities.map((facility, i) =>
          //     [`facility${i + 1}`, facility.outputs]
          //   ),
          // ),
        },
      }),
    );
  }

  setupRds() {
    const dbSubnetGroup = this.#infra.getOutput('internalDbSubnetGroup') as Output<string>;
    const dbSecGroup = this.#infra.getOutput('internalDbSecGroup') as Output<string>;

    return new DBInstance(
      `tamanu-${this.#name}`,
      {
        allocatedStorage: 20,
        autoMinorVersionUpgrade: true,
        dbSubnetGroupName: dbSubnetGroup,
        engine: 'postgres',
        engineVersion: '14.6',
        instanceClass: 'db.t4g.medium', // ARM64
        manageMasterUserPassword: true,
        networkType: 'DUAL',
        performanceInsightsEnabled: false, // adds two minutes to the boot/create time
        publiclyAccessible: false,
        skipFinalSnapshot: true, // tamanu-internal DBs should never contain important data
        storageType: 'gp3',
        username: 'postgres',
        vpcSecurityGroupIds: [dbSecGroup],
      },
      {
        parent: this,
      },
    );
  }

  databaseProvisionConfig(kind: string, index?: number) {
    const name = [kind, index].filter(Boolean).join('-');

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
          database: name,
          username: name,
          password,
      },
        namePrefix: `tamanu-internal-db-${this.#name}-`,
        description: `PostgresSQL credentials for Tamanu Internal deployment ${
          this.#name
        }, ${kind} server ${index ?? ''}`,
      },
      { parent: this },
    );

    return {
      database: name,
      owner: name,
      passwordFromSecret: secretMeta.outputs.arn,
      extensions: ['uuid-ossp'],
    };
  }

  runDbProvisioner() {
    const provisionConfig = [this.databaseProvisionConfig('central')];
    for (let i = 1; i <= this.#args.numberOfFacilities; i++) {
      this.databaseProvisionConfig('facility', i);
    }

    const dbProvisioner = this.#infra.getOutput(`internalDbProvisioner`) as Output<string>;

    new aws.lambda.Invocation(
      `${this.#name}-provisioner`,
      {
        functionName: dbProvisioner,
        input: jsonStringify(provisionConfig),
      },
      { parent: this },
    );
  }
}
