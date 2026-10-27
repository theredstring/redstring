/**
 * Lucide's "graph-star" (lucide-static 1.61.0, ISC), which the lucide-react
 * this app has (0.454) does not include. Built with lucide-react's own
 * createLucideIcon, so it takes the same props (size, strokeWidth, fill) as
 * every other icon. Drop it for the real one when lucide-react is upgraded.
 */
import { createLucideIcon } from 'lucide-react';

const GraphStar = createLucideIcon('GraphStar', [
  ['path', { d: 'm12.342 9.316 1.764-3.527', key: 'gs1' }],
  ['path', { d: 'm12.59 14.545 2.35 3.759', key: 'gs2' }],
  ['path', { d: 'm13.982 12.332 4.03.447', key: 'gs3' }],
  ['path', { d: 'M5.414 17.586 8.88 14.12', key: 'gs4' }],
  ['path', { d: 'M9.025 9.742 5.317 5.505', key: 'gs5' }],
  ['circle', { cx: '11', cy: '12', r: '3', key: 'gs6' }],
  ['circle', { cx: '15', cy: '4', r: '2', key: 'gs7' }],
  ['circle', { cx: '16', cy: '20', r: '2', key: 'gs8' }],
  ['circle', { cx: '20', cy: '13', r: '2', key: 'gs9' }],
  ['circle', { cx: '4', cy: '19', r: '2', key: 'gs10' }],
  ['circle', { cx: '4', cy: '4', r: '2', key: 'gs11' }]
]);

export default GraphStar;
