import { type Output, StackReference, all } from '@pulumi/pulumi';
import { type NetworkOutputs, fromStackReference as networkFromStackReference } from './Network.ts';

export type CrossStackNetwork = Omit<
  NetworkOutputs,
  'natSubnets' | 'workloadSubnets' | 'publicWorkloadSubnets'
> & {
  subnetIds: Output<string[]>;
};

export interface CrossStackGhaOidc {
  arn: Output<string>;
  url: Output<string>;
}

export interface CrossStackZone {
  id: Output<string>;
  name: Output<string>;
  mgmtPolicyArn: Output<string>;
}

export interface CrossStackK8sCore {
  arn: string;
  ca: string;
  endpoint: string;
  name: string;
  tags: { [key: string]: string };
  version: string;
}

export interface CrossStackK8sCoreOutput {
  arn: Output<string>;
  ca: Output<string>;
  endpoint: Output<string>;
  name: Output<string>;
  coreStack: Output<string>;
  tags: Output<{ [key: string]: string }>;
  version: Output<string>;
  backupsBucket: Output<string>;
  backupsServiceAccountArn: Output<string>;
  oidcProviderArn: Output<string>;
  opencostRoleArn: Output<string>;
  spotDataFeedBucketName: Output<string>;
  opencostExportBucketName: Output<string>;
  envoyGatewayEnabled: Output<boolean>;
  externalDnsZoneDomains: Output<string[]>;
}

export class CrossStack {
  readonly name: string;
  readonly ref: StackReference;

  constructor(name: string) {
    this.name = name;
    this.ref = new StackReference(name);
  }

  get<T>(key: string): Output<T> {
    return this.ref.getOutput(key) as unknown as Output<T>;
  }

  async getValue<T>(key: string): Promise<T> {
    const value = await this.ref.getOutputValue(key);
    return value as unknown as T;
  }

  tags(key: string = 'tags'): Output<{ [key: string]: string }> {
    return this.get(key);
  }

  // from core
  network(key: string = 'network'): CrossStackNetwork {
    const network = networkFromStackReference(this.ref, key);
    return {
      ...network,
      subnetIds: all([
        network.natSubnetIds,
        network.workloadSubnetIds,
        network.publicWorkloadSubnetIds,
      ]).apply(([nat, workload, pub]) => [...nat, ...workload, ...pub]),
    };
  }

  // from core
  ghaOidc(key: string = 'ghaOidc'): CrossStackGhaOidc {
    const ghaOidc: Output<CrossStackGhaOidc> = this.get(key);
    return {
      arn: ghaOidc.apply((oidc) => oidc.arn),
      url: ghaOidc.apply((oidc) => oidc.url),
    };
  }

  // from core
  zone(): CrossStackZone {
    return {
      id: this.get('zoneId'),
      name: this.get('zoneName'),
      mgmtPolicyArn: this.get('zoneMgmtPolicy'),
    };
  }

  // from core
  region(): Output<string> {
    return this.get('region');
  }

  // from core
  alertsTopicArn(): Output<string> {
    return this.get('alertsTopicArn');
  }

  // from k8s-core
  async k8sCore(): Promise<CrossStackK8sCore> {
    return {
      arn: await this.getValue('arn'),
      ca: await this.getValue('ca'),
      endpoint: await this.getValue('endpoint'),
      name: await this.getValue('name'),
      tags: await this.getValue('tags'),
      version: await this.getValue('version'),
    };
  }

  // from k8s-core
  k8sCoreOutput(): CrossStackK8sCoreOutput {
    return {
      arn: this.get('arn'),
      ca: this.get('ca'),
      endpoint: this.get('endpoint'),
      name: this.get('name'),
      coreStack: this.get('coreStackName'),
      tags: this.get('tags'),
      version: this.get('version'),
      backupsBucket: this.get('backupsBucket'),
      backupsServiceAccountArn: this.get('backupsServiceAccountArn'),
      oidcProviderArn: this.get('oidcProviderArn'),
      opencostRoleArn: this.get('opencostRoleArn'),
      spotDataFeedBucketName: this.get('spotDataFeedBucketName'),
      opencostExportBucketName: this.get('opencostExportBucketName'),
      envoyGatewayEnabled: this.get('envoyGatewayEnabled'),
      externalDnsZoneDomains: this.get('externalDnsZoneDomains'),
    };
  }
}
