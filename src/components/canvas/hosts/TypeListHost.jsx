import React, { Profiler, memo } from 'react';
import TypeList from '../../../TypeList.jsx';
import { onRenderProbe } from '../../../utils/perf/renderProbe.js';

/**
 * TypeList, outside NodeCanvas's renders (P2.10). TypeList takes no props: it
 * reads the active web through narrow selectors and reads selection when a chip
 * is clicked, so nothing here changes when the canvas renders.
 */
function TypeListHost() {
  return (
    <Profiler id="TypeList" onRender={onRenderProbe}>
      <TypeList />
    </Profiler>
  );
}

export default memo(TypeListHost);
