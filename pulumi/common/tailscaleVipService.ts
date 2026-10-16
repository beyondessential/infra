import {
  Config,
  dynamic,
  secret,
  type CustomResourceOptions,
  type Input,
  type Output,
} from '@pulumi/pulumi';

export interface TailscaleVipServiceArgs {
  /** Service name; must start with `svc:`. */
  name: Input<string>;
  /** Ports exposed by the service, e.g. `["tcp:443"]`. */
  ports: Input<Input<string>[]>;
  /** ACL tags applied to the service. */
  tags?: Input<Input<string>[]>;
  /** Free-form admin-panel comment. */
  comment?: Input<string>;
  /** Tailnet identifier; defaults to `-` (the authenticated tailnet). */
  tailnet?: Input<string>;
  /** Tailscale API key. Defaults to the `tailscale:apiKey` pulumi config. */
  apiKey?: Input<string>;
  /** OAuth client id. Defaults to the `tailscale:oauthClientId` pulumi config. */
  oauthClientId?: Input<string>;
  /** OAuth client secret. Defaults to the `tailscale:oauthClientSecret` pulumi config. */
  oauthClientSecret?: Input<string>;
}

interface Props {
  name: string;
  tailnet: string;
  ports: string[];
  tags: string[];
  comment: string;
  addrs: string[];
  apiKey: string;
  oauthClientId: string;
  oauthClientSecret: string;
}

const TS_API_BASE = 'https://api.tailscale.com';

async function getAuthToken(inputs: Pick<Props, 'apiKey' | 'oauthClientId' | 'oauthClientSecret'>): Promise<string> {
  if (inputs.apiKey) return inputs.apiKey;

  if (!inputs.oauthClientId || !inputs.oauthClientSecret) {
    throw new Error(
      'TailscaleVipService needs either apiKey or both oauthClientId and oauthClientSecret (typically via tailscale: pulumi config).',
    );
  }

  const res = await fetch(`${TS_API_BASE}/api/v2/oauth/token`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: inputs.oauthClientId,
      client_secret: inputs.oauthClientSecret,
    }),
  });
  if (!res.ok) {
    throw new Error(`Tailscale OAuth token exchange failed: ${res.status} ${await res.text()}`);
  }
  const json = (await res.json()) as { access_token: string };
  return json.access_token;
}

async function api(
  token: string,
  method: 'GET' | 'PUT' | 'DELETE',
  path: string,
  body?: unknown,
): Promise<unknown> {
  const res = await fetch(`${TS_API_BASE}${path}`, {
    method,
    headers: {
      authorization: `Bearer ${token}`,
      'content-type': 'application/json',
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

  if (res.status === 404) return undefined;

  const text = await res.text();
  if (!res.ok) {
    throw new Error(`Tailscale ${method} ${path} failed: ${res.status} ${text}`);
  }
  return text ? JSON.parse(text) : undefined;
}

function svcPath(tailnet: string, name: string): string {
  return `/api/v2/tailnet/${encodeURIComponent(tailnet)}/vip-services/${encodeURIComponent(name)}`;
}

interface Payload {
  name: string;
  ports: string[];
  tags?: string[];
  comment?: string;
  addrs?: string[];
}

function sortedCopy(xs: string[] | undefined): string[] {
  return [...(xs ?? [])].sort();
}

function sameStrings(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

const provider: dynamic.ResourceProvider<Props, Props> = {
  async check(_olds, news) {
    const failures: dynamic.CheckFailure[] = [];
    if (!news.name?.startsWith('svc:')) {
      failures.push({ property: 'name', reason: 'must start with "svc:"' });
    }
    if (!news.ports || news.ports.length === 0) {
      failures.push({ property: 'ports', reason: 'at least one port is required' });
    }
    const normalized: Props = {
      name: news.name ?? '',
      tailnet: news.tailnet || '-',
      ports: sortedCopy(news.ports),
      tags: sortedCopy(news.tags),
      comment: news.comment ?? '',
      addrs: sortedCopy(news.addrs),
      apiKey: news.apiKey ?? '',
      oauthClientId: news.oauthClientId ?? '',
      oauthClientSecret: news.oauthClientSecret ?? '',
    };
    return { inputs: normalized, failures: failures.length ? failures : undefined };
  },

  async diff(_id, olds, news) {
    const replaces: string[] = [];
    const changes: string[] = [];
    if (olds.name !== news.name) replaces.push('name');
    if (olds.tailnet !== news.tailnet) replaces.push('tailnet');
    if (!sameStrings(olds.ports, news.ports)) changes.push('ports');
    if (!sameStrings(olds.tags, news.tags)) changes.push('tags');
    if (olds.comment !== news.comment) changes.push('comment');
    return {
      replaces: replaces.length ? replaces : undefined,
      changes: changes.length + replaces.length > 0,
    };
  },

  async create(inputs) {
    const token = await getAuthToken(inputs);
    const body: Payload = { name: inputs.name, ports: inputs.ports };
    if (inputs.tags.length) body.tags = inputs.tags;
    if (inputs.comment) body.comment = inputs.comment;

    await api(token, 'PUT', svcPath(inputs.tailnet, inputs.name), body);
    const fetched = (await api(token, 'GET', svcPath(inputs.tailnet, inputs.name))) as Payload;

    return {
      id: inputs.name,
      outs: { ...inputs, addrs: sortedCopy(fetched?.addrs) },
    };
  },

  async update(_id, olds, news) {
    const token = await getAuthToken(news);
    // Preserve auto-allocated addrs; the API errors if we omit them on update.
    const body: Payload = {
      name: news.name,
      ports: news.ports,
      addrs: olds.addrs,
    };
    if (news.tags.length) body.tags = news.tags;
    if (news.comment) body.comment = news.comment;

    await api(token, 'PUT', svcPath(news.tailnet, news.name), body);
    return { outs: { ...news, addrs: olds.addrs } };
  },

  async delete(_id, olds) {
    const token = await getAuthToken(olds);
    await api(token, 'DELETE', svcPath(olds.tailnet, olds.name));
  },

  async read(id, olds) {
    const token = await getAuthToken(olds);
    const tailnet = olds?.tailnet || '-';
    const fetched = (await api(token, 'GET', svcPath(tailnet, id))) as Payload | undefined;
    if (!fetched) return { id };
    return {
      id,
      props: {
        ...olds,
        name: fetched.name,
        tailnet,
        ports: sortedCopy(fetched.ports),
        tags: sortedCopy(fetched.tags),
        comment: fetched.comment ?? '',
        addrs: sortedCopy(fetched.addrs),
      },
    };
  },
};

function defaultCredentials() {
  const tsConfig = new Config('tailscale');
  return {
    apiKey: tsConfig.getSecret('apiKey'),
    oauthClientId: tsConfig.get('oauthClientId'),
    oauthClientSecret: tsConfig.getSecret('oauthClientSecret'),
  };
}

export class TailscaleVipService extends dynamic.Resource {
  declare readonly name: Output<string>;
  declare readonly tailnet: Output<string>;
  declare readonly ports: Output<string[]>;
  declare readonly tags: Output<string[]>;
  declare readonly comment: Output<string>;
  declare readonly addrs: Output<string[]>;

  constructor(
    resourceName: string,
    args: TailscaleVipServiceArgs,
    opts?: CustomResourceOptions,
  ) {
    const creds = defaultCredentials();
    super(
      provider,
      resourceName,
      {
        name: args.name,
        tailnet: args.tailnet ?? '-',
        ports: args.ports,
        tags: args.tags ?? [],
        comment: args.comment ?? '',
        addrs: undefined,
        apiKey: args.apiKey ?? creds.apiKey ?? '',
        oauthClientId: args.oauthClientId ?? creds.oauthClientId ?? '',
        oauthClientSecret: args.oauthClientSecret ?? secret(creds.oauthClientSecret ?? ''),
      },
      opts,
      'tailscale',
      'VipService',
    );
  }
}
