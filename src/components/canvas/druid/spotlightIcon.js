/**
 * Lucide's "spotlight" (lucide-static 1.52.0, ISC), which the lucide-react
 * this app has (0.454) does not include. Built with lucide-react's own
 * createLucideIcon, so it takes the same props (size, strokeWidth, fill) as
 * every other icon. Drop it for the real one when lucide-react is upgraded.
 */
import { createLucideIcon } from 'lucide-react';

const Spotlight = createLucideIcon('Spotlight', [
  ['path', { d: 'M15.295 19.562 16 22', key: 'spot1' }],
  ['path', { d: 'm17 16 3.758 2.098', key: 'spot2' }],
  ['path', { d: 'm19 12.5 3.026-.598', key: 'spot3' }],
  ['path', { d: 'M7.61 6.3a3 3 0 0 0-3.92 1.3l-1.38 2.79a3 3 0 0 0 1.3 3.91l6.89 3.597a1 1 0 0 0 1.342-.447l3.106-6.211a1 1 0 0 0-.447-1.341z', key: 'spot4' }],
  ['path', { d: 'M8 9V2', key: 'spot5' }]
]);

export default Spotlight;
