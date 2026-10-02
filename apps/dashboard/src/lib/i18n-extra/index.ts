import { audienceMessages } from './audience';
import { behaviorMessages } from './behavior';
import { consoleMessages } from './console';
import { productMessages } from './product';
import { qualityMessages } from './quality';
import { trafficMessages } from './traffic';
import type { ExtraLocale, ExtraMessages } from './types';
import { workspaceMessages } from './workspace';

const EXTRAS: ExtraMessages[] = [
  consoleMessages,
  trafficMessages,
  behaviorMessages,
  audienceMessages,
  productMessages,
  qualityMessages,
  workspaceMessages,
];

/** Every console v2 string for one locale (later modules win on a duplicate key). */
export function extraMessages(locale: ExtraLocale): Record<string, string> {
  return Object.assign({}, ...EXTRAS.map((extra) => extra[locale]));
}
