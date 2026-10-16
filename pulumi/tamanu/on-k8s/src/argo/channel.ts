import { cfg } from '../../../../common/cfg.ts';
import { parseChannel } from '../../../../common/tamanuRenderer.ts';

/**
 * The renderer channel this deployment is rendered by, from its `rendererChannel` config. CD
 * writes it from the `channel` option; a stack that sets nothing is rendered by stable.
 */
export const channel = parseChannel(cfg.get('rendererChannel'));
