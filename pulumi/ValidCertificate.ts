import { ComponentResource, ComponentResourceOptions, Input, Output, all } from '@pulumi/pulumi';
import { Certificate, CertificateValidation } from '@pulumi/aws/acm';
import { Record } from '@pulumi/aws/route53';

export interface ValidCertificateArgs {
  domainName: Input<string>;
  zoneId: Input<string>;
  keyAlgorithm?: Input<string>;

  /** Any extra tags to add to all resources. */
  tags?: { [key: string]: string };
}

export interface ValidCertificateOutputs {
  domainName: Output<string>;
  certificateArn: Output<string>;
}

export class ValidCertificate extends ComponentResource {
  domainName: Output<string>;
  certificateArn: Output<string>;
  outputs: ValidCertificateOutputs;

  constructor(
    name: string,
    { domainName, keyAlgorithm, zoneId, tags = {} }: ValidCertificateArgs,
    opts: ComponentResourceOptions = {},
  ) {
    super('pkg:index:ValidCertificate', name, {}, opts);

    const certificate = new Certificate(
      name,
      {
        domainName,
        validationMethod: 'DNS',
        keyAlgorithm: keyAlgorithm ?? 'EC_prime256v1',
        tags,
      },
      { parent: this },
    );

    const validationRecord = new Record(
      `${name}-validation`,
      {
        name: certificate.domainValidationOptions[0].resourceRecordName,
        records: [certificate.domainValidationOptions[0].resourceRecordValue],
        ttl: 60,
        type: certificate.domainValidationOptions[0].resourceRecordType,
        zoneId,
      },
      { parent: certificate, deleteBeforeReplace: true },
    );

    const certificateValidation = new CertificateValidation(
      name,
      {
        certificateArn: certificate.arn,
        validationRecordFqdns: [validationRecord.fqdn],
      },
      { parent: certificate },
    );

    // bind to the validation
    this.domainName = all([domainName, certificateValidation.certificateArn]).apply(
      ([name]) => name,
    );
    this.certificateArn = certificateValidation.certificateArn;

    this.registerOutputs(
      (this.outputs = {
        domainName: this.domainName,
        certificateArn: certificateValidation.certificateArn,
      }),
    );
  }
}
