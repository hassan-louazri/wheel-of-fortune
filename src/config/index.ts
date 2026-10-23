import bundledConfig from './game.json' with { type: 'json' };
import { parseGameConfig } from './schema.ts';

export const gameConfig = parseGameConfig(bundledConfig);
