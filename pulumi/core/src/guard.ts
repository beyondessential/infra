import { Config, StackReference, getOrganization, getProject, getStack } from '@pulumi/pulumi';
import { region } from '../../common/awsAccount.ts';

// spec: CORE#account
// Runs before any resource is declared, so a wrong region fails the preview too. The
// region must come from stack config rather than the credentials' default, and must
// match the region of the previous update: otherwise every regional resource plans as
// a replacement in the new region.
const configured = new Config('aws').get('region');
if (!configured) {
  throw new Error('Refusing to run: set aws:region in the stack config');
}
if (configured !== region) {
  throw new Error(`Refusing to run: aws:region is ${configured} but the provider is in ${region}`);
}

const self = new StackReference(`${getOrganization()}/${getProject()}/${getStack()}`);
const previous = (await self.getOutputValue('region')) as string | undefined;
if (previous && previous !== region) {
  throw new Error(`Refusing to run: this core is in ${previous}, not ${region}`);
}
