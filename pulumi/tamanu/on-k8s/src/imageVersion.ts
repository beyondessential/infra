// Reads a Tamanu release version from an image in ghcr.io, without pulling it: the image's
// config carries the version in the standard OCI label that the build sets.

const REGISTRY = 'https://ghcr.io';
const VERSION_LABEL = 'org.opencontainers.image.version';

const MANIFEST_TYPES = [
  'application/vnd.oci.image.index.v1+json',
  'application/vnd.oci.image.manifest.v1+json',
  'application/vnd.docker.distribution.manifest.list.v2+json',
  'application/vnd.docker.distribution.manifest.v2+json',
];

interface Descriptor {
  digest: string;
  platform?: { os?: string; architecture?: string };
}

interface Manifest {
  manifests?: Descriptor[];
  config?: { digest: string };
}

interface ImageConfig {
  config?: { Labels?: Record<string, string> };
}

async function json<T>(fetchFn: typeof fetch, url: string, token: string, accept?: string) {
  const response = await fetchFn(url, {
    headers: { authorization: `Bearer ${token}`, ...(accept && { accept }) },
  });
  if (!response.ok) {
    throw new Error(`${url} answered ${response.status} ${response.statusText}`);
  }
  return (await response.json()) as T;
}

/**
 * The version label of the public image `repository:tag`, such as
 * `beyondessential/tamanu-central:sha-0123`, or undefined when the image has none.
 * Throws when the registry cannot be read.
 */
export async function imageVersion(
  repository: string,
  tag: string,
  fetchFn: typeof fetch = fetch,
): Promise<string | undefined> {
  const { token } = (await (
    await fetchFn(`${REGISTRY}/token?scope=repository:${repository}:pull`)
  ).json()) as { token?: string };
  if (!token) throw new Error(`${REGISTRY} gave no pull token for ${repository}`);

  const v2 = `${REGISTRY}/v2/${repository}`;
  let manifest = await json<Manifest>(
    fetchFn,
    `${v2}/manifests/${tag}`,
    token,
    MANIFEST_TYPES.join(', '),
  );
  if (manifest.manifests) {
    // A multi-platform tag: any real platform's image carries the same label. The index also
    // lists attestations, whose platform is "unknown".
    const platform = manifest.manifests.find((m) => m.platform?.os === 'linux');
    if (!platform) throw new Error(`${repository}:${tag} has no linux image`);
    manifest = await json<Manifest>(
      fetchFn,
      `${v2}/manifests/${platform.digest}`,
      token,
      MANIFEST_TYPES.join(', '),
    );
  }
  if (!manifest.config) throw new Error(`${repository}:${tag} has no image config`);

  const config = await json<ImageConfig>(fetchFn, `${v2}/blobs/${manifest.config.digest}`, token);
  return config.config?.Labels?.[VERSION_LABEL];
}
