import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';
import { jsonStringify, ComponentResource, ComponentResourceOptions } from '@pulumi/pulumi';
import * as awsClassic from '@pulumi/aws';
import { ValidCertificate } from './ValidCertificate.js';

export interface BucketWebsiteArgs {
  domain: string;
  bucketName: string;
  zoneId: string;
  logsBucket: string;
  bucketItselfPublic?: boolean;
  importBucket?: string;
  notFoundPage?: string;
  cacheBehaviour?: Omit<
    Partial<awsClassic.types.input.cloudfront.DistributionDefaultCacheBehavior>,
    'targetOriginId' | 'allowedMethods' | 'cachedMethods' | 'compress' | 'viewerProtocolPolicy'
  >;
  requestFunctionSourceFile?: string;
  unprotectBucket?: boolean;
  tags?: { [key: string]: string };
}

const DEFAULT_404 = '<!DOCTYPE html><title>404 Not Found</title><h1>404</h1><p>Not Found</p>';

export class BucketWebsite extends ComponentResource {
  readonly bucket: awsClassic.s3.BucketV2;

  constructor(
    name: string,
    {
      domain,
      bucketName,
      zoneId,
      logsBucket,
      bucketItselfPublic = false,
      importBucket,
      notFoundPage = DEFAULT_404,
      cacheBehaviour = {},
      requestFunctionSourceFile,
      unprotectBucket = false,
      tags = {},
    }: BucketWebsiteArgs,
    opts: ComponentResourceOptions = {},
  ) {
    super('bes:common:AwsBucketWebsite', name, {}, opts);

    this.bucket = new awsClassic.s3.BucketV2(
      `${name}-bucket`,
      {
        bucket: bucketName,
        tags,
      },
      { parent: this, protect: !unprotectBucket, import: importBucket },
    );

    const bucketOwnership = new awsClassic.s3.BucketOwnershipControls(
      `${name}-bucket-ownership`,
      {
        bucket: this.bucket.id,
        rule: {
          objectOwnership: 'BucketOwnerPreferred',
        },
      },
      { parent: this },
    );

    new awsClassic.s3.BucketAclV2(
      `${name}-bucket-acl`,
      {
        bucket: this.bucket.id,
        acl: 'private',
      },
      { parent: this, dependsOn: [bucketOwnership] },
    );

    const errorDocument = new awsClassic.s3.BucketObjectv2(
      `${name}-bucket-errordoc`,
      {
        key: '404.html',
        bucket: this.bucket.id,
        contentType: 'text/html',
        content: notFoundPage,
        tags,
      },
      { parent: this, deleteBeforeReplace: true },
    );

    const certificate = new ValidCertificate(
      `${name}-certificate`,
      {
        domainNames: [domain],
        zoneId,
        inUsEast1: true, // required by CloudFront
        tags,
      },
      { parent: this },
    );

    const oac = new awsClassic.cloudfront.OriginAccessControl(
      `${name}-access-control`,
      {
        description: `${bucketName} Access Control`,
        originAccessControlOriginType: 's3',
        signingBehavior: 'always',
        signingProtocol: 'sigv4',
      },
      { parent: this },
    );

    const reqFn = new awsClassic.cloudfront.Function(
      `${name}-distribution-request-function`,
      {
        runtime: 'cloudfront-js-1.0',
        comment: `Distribution Function for ${bucketName}`,
        publish: true,
        code: readFileSync(
          requestFunctionSourceFile ??
            join(dirname(fileURLToPath(import.meta.url)), 'bucket-website-request-function.js'),
          'utf-8',
        ),
      },
      { parent: this },
    );

    const originId = this.bucket.id.apply((id) => `S3-${id}`);
    const distribution = new awsClassic.cloudfront.Distribution(
      `${name}-distribution`,
      {
        comment: bucketName,
        origins: [
          {
            domainName: this.bucket.bucketRegionalDomainName,
            originAccessControlId: oac.id,
            s3OriginConfig: {
              originAccessIdentity: '', // must be an empty string
            },
            originId,
          },
        ],
        enabled: true,
        isIpv6Enabled: true,
        customErrorResponses: [
          {
            errorCode: 404,
            responseCode: 404,
            responsePagePath: errorDocument.key.apply((key) => `/${key}`),
          },
        ],
        loggingConfig: {
          includeCookies: false,
          bucket: `${logsBucket}.s3.amazonaws.com`,
          prefix: `website/${domain}`,
        },
        aliases: [domain],
        httpVersion: 'http2and3',
        defaultCacheBehavior: {
          forwardedValues: {
            queryString: true,
            cookies: {
              forward: 'none',
            },
          },
          minTtl: 0,
          defaultTtl: 3600,
          maxTtl: 86400,
          ...cacheBehaviour,
          compress: true,
          viewerProtocolPolicy: 'redirect-to-https',
          allowedMethods: ['GET', 'HEAD'],
          cachedMethods: ['GET', 'HEAD'],
          targetOriginId: originId,
          functionAssociations: [
            {
              eventType: 'viewer-request',
              functionArn: reqFn.arn,
            },
          ],
        },
        priceClass: 'PriceClass_All',
        restrictions: {
          geoRestriction: {
            restrictionType: 'none',
            locations: [], // needs to be an empty array
          },
        },
        viewerCertificate: {
          acmCertificateArn: certificate.certificateArn,
          sslSupportMethod: 'sni-only',
          minimumProtocolVersion: 'TLSv1.2_2021',
        },
        tags,
      },
      { deleteBeforeReplace: true, ignoreChanges: ['origins'], parent: this },
    );

    new awsClassic.s3.BucketPolicy(
      `${name}-bucket-policy`,
      {
        bucket: this.bucket.bucket,
        policy: jsonStringify({
          Version: '2012-10-17',
          Statement: [
            {
              Sid: 'CloudfrontRead',
              Effect: 'Allow',
              Principal: {
                Service: 'cloudfront.amazonaws.com',
              },
              Action: ['s3:GetObject'],
              Resource: this.bucket.bucket.apply((name) => `arn:aws:s3:::${name}/*`),
              Condition: {
                StringEquals: {
                  'AWS:SourceArn': distribution.arn,
                },
              },
            },
            bucketItselfPublic && {
              Sid: 'PublicRead',
              Effect: 'Allow',
              Principal: '*',
              Action: 's3:GetObject',
              Resource: this.bucket.bucket.apply((name) => `arn:aws:s3:::${name}/*`),
            },
          ].filter(Boolean),
        }),
      },
      { parent: this },
    );

    new awsClassic.route53.Record(
      `${name}-domain-ipv4`,
      {
        zoneId,
        name: domain,
        type: 'A',
        aliases: [
          {
            name: distribution.domainName,
            evaluateTargetHealth: false,
            zoneId: distribution.hostedZoneId,
          },
        ],
      },
      { parent: this },
    );

    new awsClassic.route53.Record(
      `${name}-domain-ipv6`,
      {
        zoneId,
        name: domain,
        type: 'AAAA',
        aliases: [
          {
            name: distribution.domainName,
            evaluateTargetHealth: false,
            zoneId: distribution.hostedZoneId,
          },
        ],
      },
      { parent: this },
    );
  }
}
