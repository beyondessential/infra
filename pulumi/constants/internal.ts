export const AWS_ORG_ID = 'o-asiuh5s5mc';
export const AWS_ROOT_ID = 'r-veli';

// ubuntu-24.04-arm64-btrfs-20250821 in the _Internal Tamanu account, shared with the Organisation
export const AMI_UBUNTU_ARM64 = {
  'ap-southeast-2': 'ami-0a89f7d66c5868569',
  'eu-central-2': 'ami-021d350cd38d78d8b',
  'ap-south-1': 'ami-07d3602af60bc7ac5',
};

export const AWS_TAMANU_INTERNAL_CERTBOT_POLICY = 'arn:aws:iam::143295493206:policy/CertbotRenewal';

export const TAILNET_ID = 'TZAJWRvY3B11CNTRL';
export const TAILNET_DOMAIN = 'tail53aef.ts.net';

export const LOGS_BUCKETS = {
  TAMANU: 'bes-tamanu-logs',
  DATA: 'bes-data-logs',
  TUPAIA: 'bes-tupaia-logs',
};

export const EMERGENCY_SSH_KEY =
  'ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIOpCpG0MNsBX6nNbq4jMMJwbw5c4PbuH1xBfDeNq8d0u emergency@tamanu';

export const DEFAULT_POSTGRES_VERSION = 17;

export const GATEWAY_CLASS_ENVOY = 'envoy-gateway';
