import { Output } from '@pulumi/pulumi';
import { stackName, failIfIncorrectAccount } from '../../common/coreRef.js';
await failIfIncorrectAccount();

const name = stackName === 'main' ? 'internal' : stackName;

let repos: { [key: string]: Output<string> } = {};
if (name === 'internal') {
  const { repositories } = await import('./repos.js');
  for (const { image, repo } of repositories) {
    repos[image] = repo.repositoryUri;
  }

  await import('./github.js');
}
export { repos };
