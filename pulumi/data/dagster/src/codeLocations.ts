import { basename } from 'node:path';
import { codeLocations, cpuRequest, imageRepository, imageTag, memoryRequest } from './config.ts';
import { envSecretName } from './secrets.ts';

// spec: DAGS#code-locations
function codeServer(loc: (typeof codeLocations)[number]) {
  if (!loc.file === !loc.package) {
    throw new Error(
      `codeLocations entry needs exactly one of file and package: ${JSON.stringify(loc)}`,
    );
  }
  const base = loc.file ? basename(loc.file, '.py') : loc.package!;
  const name = base.replace(/_/g, '-');
  // The name becomes the names of Kubernetes objects, so it must be a DNS-1035 label.
  if (!/^[a-z]([-a-z0-9]{0,61}[a-z0-9])?$/.test(name)) {
    throw new Error(
      `codeLocations entry gives the code server name ${JSON.stringify(name)}, which is not a DNS-1035 label`,
    );
  }
  const args = loc.file ? ['--python-file', loc.file] : ['--package-name', loc.package!];
  return {
    name,
    image: { repository: imageRepository, tag: imageTag, pullPolicy: 'Always' },
    codeServerArgs: args,
    port: 3030,
    envSecrets: [{ name: envSecretName }],
    resources: {
      requests: { cpu: cpuRequest, memory: loc.memoryRequest ?? memoryRequest },
    },
  };
}

export const userDeploymentsValues = codeLocations.map(codeServer);

const names = userDeploymentsValues.map((d) => d.name);
const duplicate = names.find((n, i) => names.indexOf(n) !== i);
if (duplicate) {
  throw new Error(`codeLocations has two entries named ${duplicate}`);
}
