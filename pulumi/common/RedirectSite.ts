import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';
import {
  ComponentResource,
  type ComponentResourceOptions,
  type Input,
  all,
  output,
} from '@pulumi/pulumi';
import * as aws from '@pulumi/aws';
import { ValidCertificate } from './ValidCertificate.ts';

export interface Redirect {
  /** Hostname served. Must be in the zone given to the RedirectSite. */
  host: Input<string>;

  /**
   * Absolute URL the hostname redirects to. The request's path and query string
   * are appended, so this must carry neither a query nor a fragment.
   */
  target: Input<string>;
}

export interface RedirectSiteArgs {
  /**
   * Hostnames to serve. A list rather than a map because the hostnames are
   * usually derived from a zone name, and so are not known until apply time —
   * but how many there are is.
   */
  redirects: Redirect[];

  /** Zone the served hostnames live in. Must be in this account. */
  zoneId: Input<string>;

  tags?: { [key: string]: string };
}

/**
 * Serves a set of hostnames with nothing but permanent redirects.
 *
 * One distribution covers every hostname, with the mapping carried in a
 * CloudFront function so a redirect never reaches an origin. Certificate
 * validation and the records both land in the given zone, so this stays inside
 * the account that already owns the DNS — no cross-account trust to arrange.
 */
export class RedirectSite extends ComponentResource {
  readonly distribution: aws.cloudfront.Distribution;

  constructor(
    name: string,
    { redirects, zoneId, tags = {} }: RedirectSiteArgs,
    opts: ComponentResourceOptions = {},
  ) {
    super('bes:common:RedirectSite', name, {}, opts);

    if (redirects.length === 0) {
      throw new Error('A RedirectSite needs at least one hostname');
    }

    const hosts = all(redirects.map(({ host }) => output(host).apply((h) => h.toLowerCase())));
    const pairs = all(
      redirects.map(({ host, target }) => all([output(host), output(target)])),
    );

    const certificate = new ValidCertificate(
      name,
      {
        domainNames: hosts,
        zoneId,
        // CloudFront only reads certificates from us-east-1.
        inUsEast1: true,
        tags,
      },
      { parent: this },
    );

    const template = readFileSync(
      join(dirname(fileURLToPath(import.meta.url)), 'redirect-site-request-function.js'),
      'utf-8',
    );

    const redirectFn = new aws.cloudfront.Function(
      `${name}-redirect`,
      {
        runtime: 'cloudfront-js-2.0',
        comment: `Redirects for ${name}`,
        publish: true,
        code: pairs.apply((entries) => {
          const targets: { [host: string]: string } = {};
          for (const [host, target] of entries) {
            const url = new URL(target);
            if (url.search || url.hash) {
              throw new Error(`Redirect target for ${host} must not have a query or fragment`);
            }

            // The request path is appended, so strip a bare or trailing slash to
            // avoid emitting a doubled one.
            targets[host.toLowerCase()] =
              `${url.protocol}//${url.host}${url.pathname.replace(/\/+$/, '')}`;
          }

          return template.replace('__REDIRECTS__', JSON.stringify(targets));
        }),
      },
      { parent: this },
    );

    const originId = 'unused';
    this.distribution = new aws.cloudfront.Distribution(
      name,
      {
        comment: hosts.apply((names) => `redirects: ${names.join(', ')}`.slice(0, 128)),
        enabled: true,
        isIpv6Enabled: true,
        aliases: hosts,
        httpVersion: 'http2and3',
        // The function answers every request, so the origin is never contacted.
        // It points at a name in our own zone that deliberately has no records:
        // if the function ever failed, the result is a gateway error rather than
        // whatever happens to be hosted at some placeholder domain.
        origins: [
          {
            originId,
            domainName: hosts.apply((names) => `origin-unused.${names[0]}`),
            customOriginConfig: {
              httpPort: 80,
              httpsPort: 443,
              originProtocolPolicy: 'https-only',
              originSslProtocols: ['TLSv1.2'],
            },
          },
        ],
        defaultCacheBehavior: {
          targetOriginId: originId,
          cachePolicyId: aws.cloudfront.getCachePolicyOutput({ name: 'Managed-CachingDisabled' }).id,
          viewerProtocolPolicy: 'redirect-to-https',
          // Redirect every method, not just reads: a client POSTing to a retired
          // API should be told where it moved rather than getting a 405.
          allowedMethods: ['GET', 'HEAD', 'OPTIONS', 'PUT', 'POST', 'PATCH', 'DELETE'],
          cachedMethods: ['GET', 'HEAD'],
          compress: false,
          functionAssociations: [
            {
              eventType: 'viewer-request',
              functionArn: redirectFn.arn,
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
      { parent: this },
    );

    for (const [i, { host }] of redirects.entries()) {
      for (const type of ['A', 'AAAA'] as const) {
        new aws.route53.Record(
          `${name}-${i}-${type}`,
          {
            zoneId,
            name: host,
            type,
            aliases: [
              {
                name: this.distribution.domainName,
                zoneId: this.distribution.hostedZoneId,
                evaluateTargetHealth: false,
              },
            ],
          },
          { parent: this, deleteBeforeReplace: true },
        );
      }
    }

    this.registerOutputs({});
  }
}
