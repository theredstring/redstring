// Temporary visual harness: mounts the real preview components with fixed data
// so they can be screenshotted without driving the whole app. Not shipped.
import React, { useEffect } from 'react';
import ReactDOM from 'react-dom/client';
import '../src/index.css';
import { initTextMeasurement } from '../src/services/textMeasurement.js';
import UnifiedBottomControlPanel from '../src/UnifiedBottomControlPanel.jsx';
import HoverVisionAid from '../src/components/HoverVisionAid.jsx';

initTextMeasurement();

const mode = new URLSearchParams(location.search).get('mode') || 'connections';

const ada = { id: 'ada', name: 'Ada Lovelace', color: '#8B0000' };
const babbage = { id: 'bab', name: 'Charles Babbage', color: '#1F4E79' };
const cat = { id: 'cat', name: 'Cat', color: '#4A5568' };
const dog = { id: 'dog', name: 'Dog', color: '#6B4C2A' };
const longA = { id: 'la', name: 'Analytical Engine Programme', color: '#8B0000' };
const longB = { id: 'lb', name: 'Difference Engine Number Two', color: '#1F4E79' };

const triple = (id, s, p, o, color = '#000000') => ({
  id, sourceId: s.id, destinationId: o.id, color,
  subject: s, predicate: { id: `p-${id}`, name: p, color }, object: o,
  hasLeftArrow: false, hasRightArrow: true
});

function Harness() {
  useEffect(() => {
    document.fonts.ready.then(() => {
      document.getElementById('root').setAttribute('data-harness-ready', '1');
    });
  }, []);

  if (mode === 'hover') {
    return (
      <div style={{ position: 'relative', height: '100vh' }}>
        <HoverVisionAid
          zoomLevel={0.2}
          headerHeight={40}
          hoveredConnection={{
            id: 'e1', source: ada, target: babbage, name: 'corresponded with', color: '#000000',
            directionality: { arrowsToward: new Set(['bab']) }
          }}
        />
        <div style={{ position: 'absolute', top: 170, left: 0, right: 0 }}>
          <HoverVisionAid zoomLevel={0.2} headerHeight={40} hoveredNode={longA} />
        </div>
      </div>
    );
  }

  if (mode === 'nodes') {
    return <UnifiedBottomControlPanel mode="nodes" selectedNodes={[ada, babbage, cat, dog]} />;
  }

  const triples = mode === 'long'
    ? [triple('e1', longA, 'is a subclass of the general', longB, '#3B6E3B')]
    : mode === 'short'
      ? [triple('e1', cat, 'chases', dog, '#7A3E9D')]
      : [triple('e1', ada, 'created', babbage)];

  return <UnifiedBottomControlPanel mode="connections" triples={triples} />;
}

ReactDOM.createRoot(document.getElementById('root')).render(<Harness />);
