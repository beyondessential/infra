export const AWS_ORG_ID = 'o-asiuh5s5mc';
export const AWS_ROOT_ID = 'r-veli';
export const AWS_PRIMARY_ACCOUNT_ID = '295280690919';

// Tupaia predates `core` and intentionally uses its default VPC, so it is
// exempt from default-VPC cleanup and the create-default-VPC deny SCP.
export const AWS_TUPAIA_ACCOUNT_ID = '843218180240';

/// https://github.com/beyondessential/linux-images
// ubuntu-26.04-bes-cloud-amd64-2026.09.16
export const AMI_UBUNTU_AMD64 = {
  'ap-south-1': 'ami-04251017a72516a76',
  'ap-southeast-2': 'ami-05311778a881d3bc9',
  'ap-southeast-6': 'ami-082dc978f04941469',
  'eu-central-2': 'ami-050c8bb1ff75c56ac',
  'us-east-1': 'ami-0cb71128e5d0635b8',
};
// ubuntu-26.04-bes-cloud-arm64-2026.09.16
export const AMI_UBUNTU_ARM64 = {
  'ap-south-1': 'ami-072b3dc977f263fb7',
  'ap-southeast-2': 'ami-06a5b6001845aa2cc',
  'ap-southeast-6': 'ami-0daba8d5e98433ded',
  'eu-central-2': 'ami-021de1e437fae98eb',
  'us-east-1': 'ami-0b7a90b378a396cfc',
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

export const DEFAULT_POSTGRES_VERSION = 18;

export const GATEWAY_CLASS_ENVOY = 'envoy-gateway';
