import { CrossStack } from './CrossStack.ts';
import { region } from './awsAccount.ts';
import { cfg } from './cfg.ts';
export { cfg };

export const $primary = new CrossStack(`bes/primary/${region}`);
