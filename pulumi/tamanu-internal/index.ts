import { readFileSync } from 'fs';
import { Config, getStack } from '@pulumi/pulumi';
import { Cluster } from './Cluster';

const cfg = new Config();
const imageTag = cfg.require('imageTag');
const initialUsers =
  cfg.getObject('initialUsers') ?? JSON.parse(readFileSync('initialUsers.json', 'utf-8'));

const { outputs: cluster } = new Cluster(
  getStack()
    .substring(0, 32)
    .replace(/(^-+|-+$)/g, ''),
  {
    imageTag,
    referenceData: {
      bucket: 'bes-tamanu-dev-referencedata',
      files: ['2023-05-01-demo-like.xlsx'],
    },
    initialUsers,
  },
);

export const { facilityCount, services } = cluster;
