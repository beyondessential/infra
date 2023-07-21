import {
  ComponentResource,
  ComponentResourceOptions,
  Input,
  Output,
  all,
  output,
} from '@pulumi/pulumi';
import { Certificate, CertificateValidation } from '@pulumi/aws/acm/index.js';
import { Record } from '@pulumi/aws/route53/index.js';

export interface ValidCertificateArgs {
  domainNames: Input<Input<string>[]>;
  zoneId: Input<string>;
  keyAlgorithm?: Input<string>;

  /** Any extra tags to add to all resources. */
  tags?: { [key: string]: string };
}

export interface ValidCertificateOutputs {
  domainNames: Output<string[]>;
  certificateArn: Output<string>;
}

export class ValidCertificate extends ComponentResource {
  domainNames: Output<string[]>;
  certificateArn: Output<string>;
  outputs: ValidCertificateOutputs;

  #name: string;

  constructor(
    name: string,
    { domainNames, keyAlgorithm, zoneId, tags = {} }: ValidCertificateArgs,
    opts: ComponentResourceOptions = {},
  ) {
    super('bes:common:ValidCertificate', name, {}, opts);
    this.#name = name;

    const certificate = new Certificate(
      name,
      {
        domainName: output(domainNames).apply(([name]) => name),
        subjectAlternativeNames: output(domainNames).apply(([first, ...names]) => names),
        validationMethod: 'DNS',
        keyAlgorithm: keyAlgorithm ?? 'EC_prime256v1',
        tags,
      },
      { parent: this },
    );

    const validationRecords = certificate.domainValidationOptions.apply((validations) =>
      validations.map(
        ({
          domainName,
          resourceRecordName: name,
          resourceRecordValue: value,
          resourceRecordType: type,
        }) =>
          new Record(
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

    const certificateValidation = new CertificateValidation(
      name,
      {
        certificateArn: certificate.arn,
        validationRecordFqdns: validationRecords.apply((records) =>
          records.map((record) => record.fqdn),
        ),
      },
      { parent: certificate },
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
