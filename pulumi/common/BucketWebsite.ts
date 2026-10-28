import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';
import { jsonStringify, ComponentResource, type ComponentResourceOptions } from '@pulumi/pulumi';
import * as awsClassic from '@pulumi/aws';
import { ValidCertificate } from './ValidCertificate.ts';

export interface BucketWebsiteArgs {
  domain: string;
  /** More names the distribution serves, each covered by the certificate and given DNS records. */
  extraDomains?: string[];
  bucketName: string;
  zoneId: string;
  logsBucket: string;
  bucketItselfPublic?: boolean;
  /**
   * Let the distribution list the bucket, so S3 answers a missing key with 404 rather than 403.
   */
  listableByDistribution?: boolean;
  importBucket?: string;
  notFoundPage?: string;
  cacheBehaviour?: Omit<
    Partial<awsClassic.types.input.cloudfront.DistributionDefaultCacheBehavior>,
    'targetOriginId' | 'allowedMethods' | 'cachedMethods' | 'compress' | 'viewerProtocolPolicy' | 'cachePolicyId'
  >;
  cachePolicy?: awsClassic.cloudfront.CachePolicy;
  requestFunctionSourceFile?: string;
  responseFunctionSourceFile?: string;
  unprotectBucket?: boolean;
  tags?: { [key: string]: string };
}

const DEFAULT_404 = '<!DOCTYPE html><title>404 Not Found</title><h1>404</h1><p>Not Found</p>';

export class BucketWebsite extends ComponentResource {
  readonly bucket: awsClassic.s3.Bucket;
  readonly distribution: awsClassic.cloudfront.Distribution;

  constructor(
    name: string,
    {
      domain,
      extraDomains = [],
      bucketName,
      zoneId,
      logsBucket,
      bucketItselfPublic = false,
      listableByDistribution = false,
      importBucket,
      notFoundPage = DEFAULT_404,
      cacheBehaviour = {},
      cachePolicy,
      requestFunctionSourceFile,
      responseFunctionSourceFile,
      unprotectBucket = false,
      tags = {},
    }: BucketWebsiteArgs,
    opts: ComponentResourceOptions = {},
  ) {
    super('bes:common:AwsBucketWebsite', name, {}, opts);

    this.bucket = new awsClassic.s3.Bucket(
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

    new awsClassic.s3.BucketAcl(
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
        contentType: 'text/html; charset=utf-8',
        content: notFoundPage,
        tags,
      },
      { parent: this, deleteBeforeReplace: true },
    );

    const certificate = new ValidCertificate(
      `${name}-certificate`,
      {
        domainNames: [domain, ...extraDomains],
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

    const policyId = cachePolicy?.id || awsClassic.cloudfront.getCachePolicyOutput({ name: 'Managed-CachingOptimized' }).id;

    const reqFn = new awsClassic.cloudfront.Function(
      `${name}-distribution-request-function`,
      {
        runtime: 'cloudfront-js-1.0',
        comment: `Distribution Request Function for ${bucketName}`,
        publish: true,
        code: readFileSync(
          requestFunctionSourceFile ??
            join(dirname(fileURLToPath(import.meta.url)), 'bucket-website-request-function.js'),
          'utf-8',
        ),
      },
      { parent: this },
    );

    const resFn = new awsClassic.cloudfront.Function(
      `${name}-distribution-response-function`,
      {
        runtime: 'cloudfront-js-1.0',
        comment: `Distribution Response Function for ${bucketName}`,
        publish: true,
        code: readFileSync(
          responseFunctionSourceFile ??
            join(dirname(fileURLToPath(import.meta.url)), 'bucket-website-response-function.js'),
          'utf-8',
        ),
      },
      { parent: this },
    );

    const originId = this.bucket.id.apply((id) => `S3-${id}`);
    this.distribution = new awsClassic.cloudfront.Distribution(
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
        aliases: [domain, ...extraDomains],
        httpVersion: 'http2and3',
        defaultCacheBehavior: {
          cachePolicyId: policyId,
          ...cacheBehaviour,
          viewerProtocolPolicy: 'redirect-to-https',
          allowedMethods: ['GET', 'HEAD'],
          cachedMethods: ['GET', 'HEAD'],
          targetOriginId: originId,
          compress: true,
          functionAssociations: [
            {
              eventType: 'viewer-request',
              functionArn: reqFn.arn,
            },
            {
              eventType: 'viewer-response',
              functionArn: resFn.arn,
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
                  'AWS:SourceArn': this.distribution.arn,
                },
              },
            },
            listableByDistribution && {
              Sid: 'CloudfrontList',
              Effect: 'Allow',
              Principal: {
                Service: 'cloudfront.amazonaws.com',
              },
              Action: ['s3:ListBucket'],
              Resource: this.bucket.bucket.apply((name) => `arn:aws:s3:::${name}`),
              Condition: {
                StringEquals: {
                  'AWS:SourceArn': this.distribution.arn,
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
            {
              Sid: 'DenyInsecureTransport',
              Effect: 'Deny',
              Principal: '*',
              Action: 's3:*',
              Resource: [
                this.bucket.bucket.apply((name) => `arn:aws:s3:::${name}`),
                this.bucket.bucket.apply((name) => `arn:aws:s3:::${name}/*`),
              ],
              Condition: {
                Bool: {
                  'aws:SecureTransport': 'false',
                },
              },
            },
          ].filter(Boolean),
        }),
      },
      { parent: this },
    );

    for (const [index, recordName] of [domain, ...extraDomains].entries()) {
      // Records for the primary name carry no suffix, so stacks without extra names keep theirs.
      const suffix = index === 0 ? '' : `-${recordName}`;
      for (const [family, type] of [
        ['ipv4', 'A'],
        ['ipv6', 'AAAA'],
      ]) {
        new awsClassic.route53.Record(
          `${name}-domain-${family}${suffix}`,
          {
            zoneId,
            name: recordName,
            type,
            aliases: [
              {
                name: this.distribution.domainName,
                evaluateTargetHealth: false,
                zoneId: this.distribution.hostedZoneId,
              },
            ],
          },
          { parent: this },
        );
      }
    }
  }
}
