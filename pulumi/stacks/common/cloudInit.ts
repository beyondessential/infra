import { stringify as yamlStringify } from 'yaml';
import { EMERGENCY_SSH_KEY } from '../constants/internal.ts';

export function hostnameCommands(hostname: string): string[][] {
  return [['hostnamectl', 'set-hostname', hostname]];
}

export function tailscaleInstallCommands(): string[][] {
  return [['sh', '-c', 'curl -fsSL https://tailscale.com/install.sh | sh']];
}

export interface TailscaleUpOptions {
  authKey: string;
  hostname: string;
  advertiseTags?: string[];
  ssh?: boolean;
  operator?: string;
}

export function tailscaleUpCommands(options: TailscaleUpOptions): string[][] {
  const { authKey, hostname, advertiseTags, ssh = true, operator = 'ubuntu' } = options;

  const args = [
    'tailscale',
    'up',
    `--auth-key=${authKey}`,
    `--hostname=${hostname}`,
  ];

  if (advertiseTags && advertiseTags.length > 0) {
    args.push(`--advertise-tags=${advertiseTags.join(',')}`);
  }

  if (ssh) {
    args.push('--ssh');
  }

  if (operator) {
    args.push(`--operator=${operator}`);
  }

  return [args, ['systemctl', 'enable', 'tailscaled']];
}

export function emergencySshKeyCommands(sshKey: string = EMERGENCY_SSH_KEY): string[][] {
  return [
    ['mkdir', '-p', '/home/ubuntu/.ssh'],
    ['sh', '-c', `echo ${sshKey} >> /home/ubuntu/.ssh/authorized_keys`],
  ];
}

export function caddyUserCommands(): string[][] {
  return [
    [
      'useradd',
      '--user-group',
      '--create-home',
      '--home-dir',
      '/var/lib/caddy',
      '--shell',
      '/usr/bin/false',
      'caddy',
    ],
    ['sh', '-c', 'echo TS_PERMIT_CERT_UID=caddy >> /etc/default/tailscaled'],
  ];
}

export function btrfsSwapFileCommands(): string[][] {
  return [
    ['mount', '/dev/disk/by-label/root', '/mnt', '-o', 'subvol=/'],
    ['btrfs', 'subvolume', 'create', '/mnt/@swap'],
    ['btrfs', 'filesystem', 'mkswapfile', '--size', '1g', '/mnt/@swap/swapfile'],
    ['umount', '/mnt'],
    ['mkdir', '/swap'],
    ['mount', '/dev/disk/by-label/root', '/swap', '-o', 'subvol=/@swap'],
    ['sh', '-c', 'echo LABEL=root /swap btrfs defaults,subvol=/@swap 0 0 >> /etc/fstab'],
    ['swapon', '/swap/swapfile'],
    ['sh', '-c', 'echo /swap/swapfile none swap defaults 0 0 >> /etc/fstab'],
  ];
}

export function cloudInitYaml(runcmd: string[][]): string {
  return `#cloud-config\n${JSON.stringify({ runcmd })}`;
}
