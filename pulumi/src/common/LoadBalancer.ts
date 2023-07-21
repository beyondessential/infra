import { ComponentResource, ComponentResourceOptions, Input, Output } from '@pulumi/pulumi';
import { Listener, LoadBalancer as AwsLoadBalancer } from '@pulumi/aws/lb/index.js';
import { Record } from '@pulumi/aws/route53/index.js';

import { ValidCertificate } from './ValidCertificate.js';

export interface LoadBalancerArgs {
  subnetIds: Input<Input<string>[]>;
  securityGroupIds: Input<Input<string>[]>;
  defaultDnsName: Input<string>;
  zoneId: Input<string>;
  certificateArn?: Input<string>;
  tags?: { [key: string]: string };
}

export interface LoadBalancerOutputs {
  arn: Output<string>;
  dnsName: Output<string>;
  listener: Output<string>;
}

export interface LoadBalancerInputs {
  arn: Input<string>;
  dnsName: Input<string>;
  listener: Input<string>;
}

export class LoadBalancer extends ComponentResource {
  lb: AwsLoadBalancer;
  listener: Listener;
  outputs: LoadBalancerOutputs;

  constructor(name: string, args: LoadBalancerArgs, opts: ComponentResourceOptions = {}) {
    super('bes:common:LoadBalancer', name, {}, opts);

    this.lb = new AwsLoadBalancer(
      name,
      {
        internal: false,
        loadBalancerType: 'application',
        subnets: args.subnetIds,
        ipAddressType: 'ipv4',
        securityGroups: args.securityGroupIds,
        tags: args.tags ?? {},
      },
      { parent: this },
    );

    // http->https redirect
    new Listener(
      `${name}-httpredirect`,
      {
        loadBalancerArn: this.lb.arn,
        port: 80,
        protocol: 'HTTP',
        defaultActions: [
          {
            type: 'redirect',
            redirect: {
              port: '443',
              protocol: 'HTTPS',
              statusCode: 'HTTP_301',
            },
          },
        ],
      },
      { parent: this.lb },
    );

    let { certificateArn } = args;
    if (!certificateArn) {
      ({ certificateArn } = new ValidCertificate(
        `${name}-default`,
        {
          domainNames: [args.defaultDnsName],
          zoneId: args.zoneId,
        },
        { parent: this },
      ));
    }

    // https termination
    this.listener = new Listener(
      `${name}-https`,
      {
        loadBalancerArn: this.lb.arn,
        port: 443,
        protocol: 'HTTPS',
        certificateArn,
        sslPolicy: 'ELBSecurityPolicy-TLS13-1-2-2021-06',
        defaultActions: [
          {
            type: 'fixed-response',
            fixedResponse: {
              contentType: 'text/plain',
              messageBody: 'These are not the droids you are looking for.',
              statusCode: '200',
            },
          },
        ],
      },
      { parent: this.lb },
    );

    new Record(
      `${name}-default`,
      {
        zoneId: args.zoneId,
        name: args.defaultDnsName,
        type: 'A',
        aliases: [
          {
            name: this.lb.dnsName,
            zoneId: this.lb.zoneId,
            evaluateTargetHealth: true,
          },
        ],
      },
      { parent: this },
    );

    this.registerOutputs(
      (this.outputs = {
        arn: this.lb.arn,
        dnsName: this.lb.dnsName,
        listener: this.listener.arn,
      }),
    );
  }
}
