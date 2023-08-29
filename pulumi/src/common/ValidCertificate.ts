import {
  ComponentResource,
  ComponentResourceOptions,
  Input,
  Output,
  all,
  output,
} from '@pulumi/pulumi';
import * as aws from '@pulumi/aws';

export interface ValidCertificateArgs {
  domainNames: Input<Input<string>[]>;
  zoneId: Input<string>;
  keyAlgorithm?: Input<string>;
  inUsEast1?: Input<boolean>;

  /** Any extra tags to add to all resources. */
  tags?: { [key: string]: string };
}

export interface ValidCertificateOutputs {
  domainNames: Output<string[]>;
  certificateArn: Output<string>;
}

export class ValidCertificate extends ComponentResource {
  readonly domainNames: Output<string[]>;
  readonly certificateArn: Output<string>;
  readonly outputs: ValidCertificateOutputs;

  #name: string;

  constructor(
    name: string,
    { domainNames, keyAlgorithm, zoneId, inUsEast1 = false, tags = {} }: ValidCertificateArgs,
    opts: ComponentResourceOptions = {},
  ) {
    super('bes:common:ValidCertificate', name, {}, opts);
    this.#name = name;

    const provider = inUsEast1
      ? new aws.Provider(
          'us-east-1',
          {
            region: 'us-east-1',
          },
          { parent: this },
        )
      : undefined;

    const certificate = new aws.acm.Certificate(
      name,
      {
        domainName: output(domainNames).apply(([name]) => name),
        subjectAlternativeNames: domainNames,
        validationMethod: 'DNS',
        keyAlgorithm: keyAlgorithm ?? 'EC_prime256v1',
        tags,
      },
      { provider, parent: this },
    );

    const validationRecords = certificate.domainValidationOptions.apply((validations) =>
      validations.map(
        ({
          domainName,
          resourceRecordName: name,
          resourceRecordValue: value,
          resourceRecordType: type,
        }) =>
          new aws.route53.Record(
            `${this.#name}-validation-${domainName}`,
            {
              name,
              records: [value],
              ttl: 60,
              type,
              zoneId,
            },
            { parent: certificate, deleteBeforeReplace: true },
          ),
      ),
    );

    const certificateValidation = new aws.acm.CertificateValidation(
      name,
      {
        certificateArn: certificate.arn,
        validationRecordFqdns: validationRecords.apply((records) =>
          records.map((record) => record.fqdn),
        ),
      },
      { provider, parent: certificate },
    );

    // bind to the validation
    this.domainNames = all([domainNames, certificateValidation.certificateArn]).apply(
      ([names]) => names,
    );
    this.certificateArn = certificateValidation.certificateArn;

    this.registerOutputs(
      (this.outputs = {
        domainNames: this.domainNames,
        certificateArn: this.certificateArn,
      }),
    );
  }
}
