import { Output } from '@pulumi/pulumi';
import { stackName, failIfIncorrectAccount } from '../../common/coreRef.ts';
failIfIncorrectAccount();

const name = stackName === 'main' ? 'internal' : stackName;
if (name === 'internal') {
  await import('./github.js');
}
