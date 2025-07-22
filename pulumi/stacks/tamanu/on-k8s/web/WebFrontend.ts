import { ComponentResource, type ComponentResourceOptions } from '@pulumi/pulumi';
import * as k8s from '@pulumi/kubernetes';
import { type ServerType, podSpecFactory } from './specs.ts';
import { runWeb } from './frontend.ts';
import { ImageType } from '../image.ts';

export interface WebFrontendArgs {
  serverType: ServerType;
  instance?: string;
  replicas?: number;
  imageType?: ImageType;
}

export class WebFrontend extends ComponentResource {
  readonly service: k8s.core.v1.Service;
  readonly deployment: k8s.apps.v1.Deployment;

  constructor(
    name: string,
    {
      serverType,
      instance,
      replicas = 2, // as it runs on spot
      imageType = 'frontend',
    }: WebFrontendArgs,
    opts: ComponentResourceOptions = {},
  ) {
    super('bes:tamanu:WebFrontend', name, {}, opts);

    const { deployment, service } = runWeb(name, {
      parent: this,
      serverType,
      instance,
      replicas,
      podSpec: podSpecFactory(imageType),
    });

    this.deployment = deployment;
    this.service = service;
  }
}
