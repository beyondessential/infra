export const AWS_ORG_ID = 'o-asiuh5s5mc';
export const AWS_ROOT_ID = 'r-veli';
export const AWS_PRIMARY_ACCOUNT_ID = '295280690919';

// Tupaia predates `core` and intentionally uses its default VPC, so it is
// exempt from default-VPC cleanup and the create-default-VPC deny SCP.
export const AWS_TUPAIA_ACCOUNT_ID = '843218180240';

/// https://github.com/beyondessential/linux-images
// ubuntu-26.04-bes-cloud-amd64-2026.06.29
export const AMI_UBUNTU_AMD64 = {
  'ap-south-1': 'ami-007264e074a554321',
  'ap-southeast-2': 'ami-0dcc5ab3f999f08c3',
  'ap-southeast-6': 'ami-00144bd996bacce85',
  'eu-central-2': 'ami-0314ebaf9cb64bc3b',
  'us-east-1': 'ami-0d65140366d2566bb',
};
// ubuntu-26.04-bes-cloud-arm64-2026.06.29
export const AMI_UBUNTU_ARM64 = {
  'ap-south-1': 'ami-067d6a49c7dda3e62',
  'ap-southeast-2': 'ami-0278794ea21341263',
  'ap-southeast-6': 'ami-03c121a868502851e',
  'eu-central-2': 'ami-089725ab241c76a0d',
  'us-east-1': 'ami-099dca3f8b93ae423',
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
