import { X509Certificate, createHash } from 'node:crypto';

import * as aws from '@pulumi/aws';
import { local } from '@pulumi/command';
import { all, jsonStringify, secret, unsecret } from '@pulumi/pulumi';
import { DeviceKey, TailnetKey, getDeviceOutput } from '@pulumi/tailscale';

import { region } from '../common/awsAccount.ts';
import { CrossStack } from '../common/CrossStack.ts';
import { AMI_UBUNTU_ARM64, TAILNET_DOMAIN } from '../constants/internal.ts';
import * as securityGroupRules from '../common/securityGroupRules.ts';
import { workloadAlertsCentralArn } from '../common/alertsHubRef.ts';
import { ec2StatusAlarms } from '../common/ec2StatusAlarms.ts';
import {
  cloudInitYaml,
  hostnameCommands,
  tailscaleInstallCommands,
  tailscaleUpCommands,
  emergencySshKeyCommands,
  btrfsSwapFileCommands,
} from '../common/cloudInit.ts';

import {
  core,
  instanceType,
  regionId,
  stunAllowCidrs,
  derpHostname,
  tailscaleVersion,
  goTarball,
  goSha256,
  nodeName,
  tailscaleName,
  tailscaleTags,
} from './config.ts';

// The client-side pin still enforces NotBefore/NotAfter, so a cert minted with
// the usual `now + N` window would fail against the very clock skew this relay
// exists to route around. @pulumi/tls can't backdate NotBefore, so openssl
// (>= 3.4, for -not_before) mints it once on create; the pin stays stable
// after that.
const certGen = new local.Command(
  'iti-derp-cert',
  {
    create: `set -eu
d=$(mktemp -d)
trap 'rm -rf "$d"' EXIT
openssl req -x509 -newkey ec -pkeyopt ec_paramgen_curve:prime256v1 -nodes \\
  -keyout "$d/key" -out "$d/crt" \\
  -subj "/CN=$DERP_HOSTNAME" -addext "subjectAltName=DNS:$DERP_HOSTNAME" \\
  -not_before 20000101000000Z -not_after 20991231235959Z 2>/dev/null
cat "$d/crt" "$d/key"`,
    environment: { DERP_HOSTNAME: derpHostname },
    logging: 'none',
  },
  { additionalSecretOutputs: ['stdout'] },
);

function pemBlock(pem: string, label: string): string {
  const match = new RegExp(`-----BEGIN ${label}-----[\\s\\S]+?-----END ${label}-----\\n?`).exec(pem);
  if (!match) {
    throw new Error(`openssl output has no ${label}`);
  }
  return match[0];
}

const certPem = certGen.stdout.apply((out) => pemBlock(out, 'CERTIFICATE'));
const keyPem = certGen.stdout.apply((out) => pemBlock(out, 'PRIVATE KEY'));
const certName = unsecret(
  certPem.apply(
    (pem) => `sha256-raw:${createHash('sha256').update(new X509Certificate(pem).raw).digest('hex')}`,
  ),
);

const $core = new CrossStack(core);
const $network = $core.network();
const tags = {
  Name: nodeName,
  Purpose: 'Tailscale',
};

const sg = new aws.ec2.SecurityGroup('iti-derp', {
  vpcId: $network.vpc,
  description: 'Tailscale DERP relay',
  ingress: [
    ...securityGroupRules.allICMP,
    securityGroupRules.openPort('DERP', 443),
    {
      description: 'STUN',
      fromPort: 3478,
      toPort: 3478,
      protocol: 'udp',
      cidrBlocks: stunAllowCidrs,
    },
  ],
  egress: [securityGroupRules.all],
  tags,
});

// Allocated apart from the instance so its address is known before boot and
// survives an instance replacement: the DERP map pins it.
const eip = new aws.ec2.Eip('iti-derp', {
  domain: 'vpc',
  tags,
});

const authKey = new TailnetKey('iti-derp', {
  ephemeral: false,
  expiry: 15 * 60,
  reusable: false,
  preauthorized: true,
  tags: tailscaleTags,
}, { ignoreChanges: ['tags'] });

const certDir = '/etc/derper';
const unit = `[Unit]
Description=Tailscale DERP relay
After=network-online.target tailscaled.service
Wants=network-online.target

[Service]
ExecStart=/usr/local/bin/derper -c /var/lib/derper/derper.key --hostname=${derpHostname} --certmode=manual --certdir=%d --a=:443 --http-port=-1 --stun-port=3478 --verify-clients
LoadCredential=${derpHostname}.crt:${certDir}/${derpHostname}.crt
LoadCredential=${derpHostname}.key:${certDir}/${derpHostname}.key
DynamicUser=yes
StateDirectory=derper
ReadWritePaths=/run/tailscale
AmbientCapabilities=CAP_NET_BIND_SERVICE
CapabilityBoundingSet=CAP_NET_BIND_SERVICE
NoNewPrivileges=yes
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
`;

function writeFile(path: string, content: string): string[] {
  const b64 = Buffer.from(content).toString('base64');
  return ['sh', '-c', `umask 077 && echo ${b64} | base64 -d > ${path}`];
}

const box = new aws.ec2.Instance(
  'iti-derp',
  {
    ami: AMI_UBUNTU_ARM64[region],
    instanceType,
    keyName: 'ops',
    rootBlockDevice: {
      volumeSize: 8,
      volumeType: 'gp3',
      encrypted: true,
    },
    metadataOptions: {
      httpTokens: 'required',
      httpProtocolIpv6: 'enabled',
      instanceMetadataTags: 'enabled',
    },
    subnetId: $network.publicWorkloadSubnetIds.apply((ids) => ids[0]),
    vpcSecurityGroupIds: [sg.id],
    userData: all([authKey.key, certPem, keyPem]).apply(([authKey, certPem, keyPem]) =>
      secret(
        cloudInitYaml([
          ...hostnameCommands(tailscaleName),
          ...btrfsSwapFileCommands(),
          ...tailscaleInstallCommands(),
          ...tailscaleUpCommands({ authKey, hostname: tailscaleName }),
          ...emergencySshKeyCommands(),
          ['mkdir', '-p', '-m', '0700', certDir],
          writeFile(`${certDir}/${derpHostname}.crt`, certPem),
          writeFile(`${certDir}/${derpHostname}.key`, keyPem),
          [
            'sh',
            '-c',
            `curl -fsSLo /tmp/go.tgz https://go.dev/dl/${goTarball} && echo "${goSha256}  /tmp/go.tgz" | sha256sum -c - && tar -C /usr/local -xzf /tmp/go.tgz && rm /tmp/go.tgz`,
          ],
          [
            'env',
            'HOME=/root',
            'GOTOOLCHAIN=local',
            'GOBIN=/usr/local/bin',
            '/usr/local/go/bin/go',
            'install',
            `tailscale.com/cmd/derper@${tailscaleVersion}`,
          ],
          writeFile('/etc/systemd/system/derper.service', unit),
          ['systemctl', 'daemon-reload'],
          ['systemctl', 'enable', '--now', 'derper'],
        ]),
      ),
    ),
    tags,
  },
  {
    parent: authKey,
    ignoreChanges: ['ami'],
  },
);

new aws.ec2.EipAssociation('iti-derp', {
  allocationId: eip.allocationId,
  instanceId: box.id,
});

ec2StatusAlarms(
  'iti-derp',
  {
    instanceId: box.id,
    notifyTopicArns: [$core.alertsTopicArn(), workloadAlertsCentralArn],
    tags,
  },
  { parent: box },
);

const tailscaleDevice = getDeviceOutput({
  name: box.arn.apply((_) => `${tailscaleName}.${TAILNET_DOMAIN}`),
  waitFor: '15m',
});

new DeviceKey(
  'iti-derp',
  {
    deviceId: tailscaleDevice.id,
    keyExpiryDisabled: true,
  },
  { parent: authKey },
);

export const ip = eip.publicIp;
export const tailscale = {
  name: tailscaleDevice.name,
  addresses: tailscaleDevice.addresses,
  tags: tailscaleTags,
};

// Paste under the policy's derpMap.Regions.
export const derpRegion = jsonStringify({
  RegionID: regionId,
  RegionCode: 'iti',
  RegionName: 'Iti recovery (Sydney)',
  Nodes: [
    {
      Name: `${regionId}a`,
      RegionID: regionId,
      HostName: derpHostname,
      IPv4: eip.publicIp,
      IPv6: 'none',
      CertName: certName,
    },
  ],
});
