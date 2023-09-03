import { readFileSync } from 'fs';
import { jsonStringify } from '@pulumi/pulumi';
import * as aws from '@pulumi/aws';
import { ValidCertificate } from '../../common/ValidCertificate.js';
import { LOGS_BUCKETS } from '../../constants/internal.js';

const DOMAIN = 'dbtdocs.data.bes.au';
const ZONE_ID = 'Z0831938RFS8SDSX2K7H';
const LOGS_BUCKET = LOGS_BUCKETS.TAMANU;

const bucket = new aws.s3.BucketV2(
  'bucket',
  {
    bucket: 'bes-tamanu-data-dbtdocs',
  },
  { protect: true },
);

const bucketOwnership = new aws.s3.BucketOwnershipControls(
  'bucket-ownership',
  {
    bucket: bucket.id,
    rule: {
      objectOwnership: 'BucketOwnerPreferred',
    },
  },
  { parent: bucket },
);

new aws.s3.BucketAclV2(
  'bucket-acl',
  {
    bucket: bucket.id,
    acl: 'private',
  },
  { parent: bucket, dependsOn: [bucketOwnership] },
);

const errorDocument = new aws.s3.BucketObjectv2(
  'bucket-errordoc',
  {
    key: '404.html',
    bucket: bucket.id,
    contentType: 'text/html',
    content: '<!DOCTYPE html><title>dbt Docs | 404</title><h1>404</h1><p>Not Found</p>',
  },
  { parent: bucket },
);

const certificate = new ValidCertificate('certificate', {
  domainNames: [DOMAIN],
  zoneId: ZONE_ID,
  inUsEast1: true, // required by CloudFront
});

const oac = new aws.cloudfront.OriginAccessControl('access-control', {
  description: 'DBT Docs Access Control',
  originAccessControlOriginType: 's3',
  signingBehavior: 'always',
  signingProtocol: 'sigv4',
});

const reqFn = new aws.cloudfront.Function('distribution-request-function', {
  runtime: 'cloudfront-js-1.0',
  comment: 'Distribution Function for dbt Docs',
  publish: true,
  code: readFileSync('request-function.js', 'utf-8'),
});

const originId = bucket.id.apply((id) => `S3-${id}`);
const distribution = new aws.cloudfront.Distribution(
  'distribution',
  {
    comment: 'dbt Docs',
    origins: [
      {
        domainName: bucket.bucketRegionalDomainName,
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
      bucket: `${LOGS_BUCKET}.s3.amazonaws.com`,
      prefix: 'dbt-docs',
    },
    aliases: [DOMAIN],
    httpVersion: 'http2and3',
    defaultCacheBehavior: {
      allowedMethods: ['GET', 'HEAD'],
      cachedMethods: ['GET', 'HEAD'],
      targetOriginId: originId,
      forwardedValues: {
        queryString: false,
        cookies: {
          forward: 'none',
        },
      },
      minTtl: 0,
      defaultTtl: 3600,
      maxTtl: 86400,
      compress: true,
      viewerProtocolPolicy: 'redirect-to-https',
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
  },
  { deleteBeforeReplace: true, ignoreChanges: ['origins'] },
);

new aws.s3.BucketPolicy(
  'bucket-policy',
  {
    bucket: bucket.bucket,
    policy: jsonStringify({
      Version: '2012-10-17',
      Statement: [
        {
          Effect: 'Allow',
          Principal: {
            Service: 'cloudfront.amazonaws.com',
          },
          Action: ['s3:GetObject'],
          Resource: [bucket.bucket.apply((name) => `arn:aws:s3:::${name}/*`)],
          Condition: {
            StringEquals: {
              'AWS:SourceArn': distribution.arn,
            },
          },
        },
      ],
    }),
  },
  { parent: bucket },
);

new aws.route53.Record('domain-ipv4', {
  zoneId: ZONE_ID,
  name: DOMAIN,
  type: 'A',
  aliases: [
    {
      name: distribution.domainName,
      evaluateTargetHealth: false,
      zoneId: distribution.hostedZoneId,
    },
  ],
});

new aws.route53.Record('domain-ipv6', {
  zoneId: ZONE_ID,
  name: DOMAIN,
  type: 'AAAA',
  aliases: [
    {
      name: distribution.domainName,
      evaluateTargetHealth: false,
      zoneId: distribution.hostedZoneId,
    },
  ],
});
