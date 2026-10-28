import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { DOMAIN } from './constants.ts';

type Header = { value: string; multiValue?: { value: string }[] };
type Headers = { [name: string]: Header };
type Querystring = { [name: string]: Header };
type Request = { method: string; uri: string; querystring: Querystring; headers: Headers };
type Response = { statusCode: number; statusDescription?: string; headers?: Headers };

// The functions are plain CloudFront scripts that define `handler`, so load them the way
// CloudFront does rather than importing them. Results are copied out of the script's context
// so they compare as plain objects.
function load<E, R>(file: string): (event: E) => R {
  const source = readFileSync(new URL(file, import.meta.url), 'utf-8');
  const handler = runInNewContext(`${source}\n;handler`) as (event: E) => R;
  return (event) => JSON.parse(JSON.stringify(handler(event)));
}

const onRequest = load<{ request: Request }, Request | Response>('./request-function.js');
const onResponse = load<{ request: Request; response: Response }, Response>(
  './response-function.js',
);

function request(
  host: string,
  uri: string,
  { acceptEncoding, querystring = {} }: { acceptEncoding?: string; querystring?: Querystring } = {},
) {
  const headers: Headers = { host: { value: host } };
  if (acceptEncoding !== undefined) {
    headers['accept-encoding'] = { value: acceptEncoding };
  }
  return onRequest({ request: { method: 'GET', uri, querystring, headers } });
}

function servedFrom(...args: Parameters<typeof request>): string {
  const result = request(...args);
  assert.ok('uri' in result, `expected a request, got status ${(result as Response).statusCode}`);
  return result.uri;
}

// spec: BLWEB#addresses
test('the apex is served from the production prefix', () => {
  assert.equal(servedFrom(DOMAIN, '/'), '/prod/index.html');
});

// spec: BLWEB#addresses
test('a pull request host is served from its preview prefix', () => {
  assert.equal(servedFrom(`pr-42.${DOMAIN}`, '/provision'), '/previews/pr-42/provision.html');
});

// spec: BLWEB#addresses
test('hosts are matched without regard to case or a port', () => {
  assert.equal(servedFrom('ITI.Tamanu.App:443', '/'), '/prod/index.html');
});

// spec: BLWEB#addresses
test('any other host answers 404', () => {
  for (const host of [
    `foo.${DOMAIN}`,
    `pr-abc.${DOMAIN}`,
    `pr-.${DOMAIN}`,
    `pr-01.${DOMAIN}`,
    `a.pr-1.${DOMAIN}`,
    'd111111abcdef8.cloudfront.net',
    '',
  ]) {
    assert.deepEqual(request(host, '/'), { statusCode: 404, statusDescription: 'Not Found' }, host);
  }
});

// spec: BLWEB#routing
test('a path without an extension is served from that path plus .html', () => {
  assert.equal(servedFrom(DOMAIN, '/provision'), '/prod/provision.html');
  assert.equal(servedFrom(DOMAIN, '/docs/assemble'), '/prod/docs/assemble.html');
});

// spec: BLWEB#routing
test('a path with an extension is served from that path', () => {
  assert.equal(servedFrom(DOMAIN, '/assets/logo.png'), '/prod/assets/logo.png');
  assert.equal(servedFrom(DOMAIN, '/assets/app.css'), '/prod/assets/app.css');
});

// spec: BLWEB#routing
test('only the last segment decides whether a path has an extension', () => {
  assert.equal(servedFrom(DOMAIN, '/v1.2/notes'), '/prod/v1.2/notes.html');
});

// spec: BLWEB#routing
test('a trailing slash redirects permanently to the path without it, keeping the query', () => {
  assert.deepEqual(
    request(DOMAIN, '/provision/', {
      querystring: {
        x: { value: '1' },
        tag: { value: 'a', multiValue: [{ value: 'a' }, { value: 'b' }] },
      },
    }),
    {
      statusCode: 308,
      statusDescription: 'Permanent Redirect',
      headers: { location: { value: '/provision?x=1&tag=a&tag=b' } },
    },
  );
  assert.deepEqual((request(DOMAIN, '/docs//') as Response).headers?.location, { value: '/docs' });
});

// spec: BLWEB#pre-compressed-variants
test('the most preferred acceptable coding picks the variant', () => {
  assert.equal(
    servedFrom(DOMAIN, '/app.js', { acceptEncoding: 'gzip, deflate, br, zstd' }),
    '/prod/app.js.zst',
  );
  assert.equal(servedFrom(DOMAIN, '/app.js', { acceptEncoding: 'gzip, br' }), '/prod/app.js.br');
  assert.equal(servedFrom(DOMAIN, '/app.js', { acceptEncoding: 'gzip' }), '/prod/app.js.gz');
});

// spec: BLWEB#pre-compressed-variants
test('a coding weighted zero is not acceptable', () => {
  assert.equal(
    servedFrom(DOMAIN, '/app.js', { acceptEncoding: 'zstd;q=0, br;q=0.5' }),
    '/prod/app.js.br',
  );
  assert.equal(servedFrom(DOMAIN, '/app.js', { acceptEncoding: '*' }), '/prod/app.js.zst');
  assert.equal(servedFrom(DOMAIN, '/app.js', { acceptEncoding: 'zstd;q=0, *' }), '/prod/app.js.br');
  assert.equal(
    servedFrom(DOMAIN, '/app.js', { acceptEncoding: 'zstd;q=0, br;q=0, *;q=0' }),
    '/prod/app.js',
  );
});

// spec: BLWEB#pre-compressed-variants
test('with no acceptable coding the original is served', () => {
  assert.equal(servedFrom(DOMAIN, '/app.js'), '/prod/app.js');
  assert.equal(servedFrom(DOMAIN, '/app.js', { acceptEncoding: 'identity' }), '/prod/app.js');
});

// spec: BLWEB#pre-compressed-variants
test('pages are routed before a variant is chosen', () => {
  assert.equal(
    servedFrom(DOMAIN, '/provision', { acceptEncoding: 'br' }),
    '/prod/provision.html.br',
  );
  assert.equal(servedFrom(DOMAIN, '/', { acceptEncoding: 'br' }), '/prod/index.html.br');
});

// spec: BLWEB#pre-compressed-variants
test('every compressible extension gets a variant', () => {
  for (const ext of ['html', 'js', 'mjs', 'css', 'json', 'svg', 'wasm', 'webmanifest']) {
    assert.equal(servedFrom(DOMAIN, `/a.${ext}`, { acceptEncoding: 'gzip' }), `/prod/a.${ext}.gz`);
  }
});

// spec: BLWEB#pre-compressed-variants
test('objects outside the compressible extensions never get a variant', () => {
  for (const path of ['/logo.png', '/photo.jpg', '/font.woff2', '/app.js.map']) {
    assert.equal(servedFrom(DOMAIN, path, { acceptEncoding: 'zstd, br, gzip' }), `/prod${path}`);
  }
});

// spec: BLWEB#pre-compressed-variants
test('a request with several Accept-Encoding headers considers all of them', () => {
  const result = onRequest({
    request: {
      method: 'GET',
      uri: '/app.js',
      querystring: {},
      headers: {
        host: { value: DOMAIN },
        'accept-encoding': { value: 'gzip', multiValue: [{ value: 'gzip' }, { value: 'zstd' }] },
      },
    },
  });
  assert.equal((result as Request).uri, '/prod/app.js.zst');
});

function vary(existing?: string): string | undefined {
  const headers: Headers = {};
  if (existing !== undefined) {
    headers.vary = { value: existing };
  }
  const response = onResponse({
    request: { method: 'GET', uri: '/prod/app.js.br', querystring: {}, headers: {} },
    response: { statusCode: 200, headers },
  });
  return response.headers?.vary?.value;
}

// spec: BLWEB#pre-compressed-variants
test('responses vary on Accept-Encoding', () => {
  assert.equal(vary(), 'Accept-Encoding');
  assert.equal(vary('Origin'), 'Origin, Accept-Encoding');
  assert.equal(vary('accept-encoding'), 'accept-encoding');
  assert.equal(vary('Origin, Accept-Encoding'), 'Origin, Accept-Encoding');
  assert.equal(vary('*'), '*');
});
