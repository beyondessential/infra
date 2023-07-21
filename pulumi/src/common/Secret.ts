import {
  ComponentResource,
  ComponentResourceOptions,
  Input,
  Output,
  jsonStringify,
} from '@pulumi/pulumi';
import * as aws from '@pulumi/aws';

export interface SecretArgs extends aws.secretsmanager.SecretArgs {
  secretValue: Input<any>;
}

export interface SecretOutputs {
  arn: Output<string>;
  versionId: Output<string>;
}

export class Secret extends ComponentResource {
  outputs: SecretOutputs;

  constructor(name: string, args: SecretArgs, opts: ComponentResourceOptions = {}) {
    super('bes:common:AwsSecret', name, {}, opts);
    const { secretValue, namePrefix, ...metaArgs } = args;

    const secretMeta = new aws.secretsmanager.Secret(name, {
      namePrefix: namePrefix ? `${namePrefix}-${name}-` : `${name}-`,
      ...metaArgs
    }, { parent: this });

    const secretVersion = new aws.secretsmanager.SecretVersion(
      name,
      {
        secretId: secretMeta.id,
        secretString: jsonStringify(secretValue),
      },
      {
        parent: secretMeta,
      },
    );

    this.registerOutputs(
      (this.outputs = {
        arn: secretMeta.arn,
        versionId: secretVersion.versionId,
      }),
    );
  }
}
