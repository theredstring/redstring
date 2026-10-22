/**
 * New Thing Group's two pages (see thingGroupPrompt.js). First the Thing, in
 * the same selector the plus sign names a Thing with. Then, for a Thing that
 * already has Webs, which one opens: its Webs as cards, as the Open Webs list
 * draws them, and last a card with a + that opens a new one. A Thing with no
 * Web skips that page and opens a new one, as expanding it would.
 *
 * Choosing ends in the plus sign: it morphs into the Thing, which opens in
 * place once it has landed (plusSign.js, `openDefinition`).
 */
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import UnifiedSelector from '../../../UnifiedSelector';
import WebCard from '../../webPreview/WebCard.jsx';
import { DefinitionCard } from '../../panel/WebDefinitionsSection.jsx';
import useGraphStore from '../../../store/graphStore.js';
import { getNodeDimensions } from '../../../utils.js';
import { haptic } from '../../../services/haptics.js';
import { NODE_DEFAULT_COLOR } from '../../../constants';
import { setDialogColorPickerVisible } from '../colorPickers/colorPickers.js';
import {
  useThingGroupPromptStore, showThingWebs, openThingGroupPrompt, closeThingGroupPrompt, websOf,
} from './thingGroupPrompt.js';

// Webs a row: each as wide as the box allows, three at most; under five they
// all go in one row.
const GAP_PX = 14;
const MAX_COLUMNS = 3;
const ONE_ROW_BELOW = 5;
// The cards' titles sit this much lower in their bands here (ems of the title).
const TITLE_DROP = 0.15;

/** One card in the Web grid: chosen by click or a tap that didn't scroll. */
function WebChoice({ title, onChoose, children }) {
  const touch = useRef({ x: 0, y: 0, moved: false });
  const touchHandled = useRef(false);
  return (
    <div
      className="unified-selector-card"
      title={title}
      style={{ cursor: 'pointer', transition: 'transform 0.2s ease, filter 0.2s ease', touchAction: 'manipulation', WebkitTapHighlightColor: 'transparent' }}
      onMouseEnter={(e) => { e.currentTarget.style.transform = 'scale(1.03)'; e.currentTarget.style.filter = 'brightness(1.1)'; }}
      onMouseLeave={(e) => { e.currentTarget.style.transform = 'scale(1)'; e.currentTarget.style.filter = 'brightness(1)'; }}
      onPointerDown={(e) => e.stopPropagation()}
      onTouchStart={(e) => { const t = e.touches[0]; touch.current = { x: t.clientX, y: t.clientY, moved: false }; }}
      onTouchMove={(e) => {
        const t = e.touches[0];
        if ((t.clientX - touch.current.x) ** 2 + (t.clientY - touch.current.y) ** 2 > 100) touch.current.moved = true;
      }}
      onTouchEnd={(e) => {
        e.stopPropagation();
        if (touch.current.moved) return;
        // No synthesized click on the canvas this page stops covering.
        if (e.cancelable) e.preventDefault();
        touchHandled.current = true;
        onChoose();
      }}
      onClick={(e) => {
        e.stopPropagation();
        if (touchHandled.current) return;
        onChoose();
      }}
    >
      {children}
    </div>
  );
}

/**
 * The Thing's Webs and the new-Web card, in the selector's grid box: as large
 * as the box's width allows. A single row is also kept to the box's height, so
 * it shows whole without scrolling.
 */
function WebGrid({ prototype, onChoose }) {
  const graphs = useGraphStore(s => s.graphs);
  useGraphStore(s => s.textSettings); // the cards' proportions follow it
  const ref = useRef(null);
  const [box, setBox] = useState(null);
  useLayoutEffect(() => {
    const scroller = ref.current?.parentElement;
    if (!scroller) return undefined;
    const measure = () => {
      const cs = getComputedStyle(scroller);
      setBox({
        w: scroller.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight),
        h: scroller.clientHeight - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom),
      });
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(scroller);
    return () => observer.disconnect();
  }, []);

  const webs = websOf(prototype, graphs);
  const color = prototype.color || NODE_DEFAULT_COLOR;
  const count = webs.length + 1;
  const columns = count < ONE_ROW_BELOW ? count : MAX_COLUMNS;
  const oneRow = count <= columns;
  let cardWidth = 0;
  if (box) {
    // WebCard keeps the canvas's proportions for the Thing's name.
    const dims = getNodeDimensions({ name: prototype.name }, true, null);
    const ratio = dims.currentHeight / dims.currentWidth;
    cardWidth = (box.w - GAP_PX * (columns - 1)) / columns;
    if (oneRow) cardWidth = Math.min(cardWidth, box.h / ratio);
    cardWidth = Math.max(0, Math.floor(cardWidth));
  }

  return (
    <div
      ref={ref}
      style={{
        display: 'grid',
        gridTemplateColumns: `repeat(${columns}, ${cardWidth}px)`,
        justifyContent: 'center',
        alignContent: 'start',
        gap: GAP_PX,
      }}
    >
      {box && webs.map(({ graphId, index }) => (
        <WebChoice key={graphId} title={graphs.get(graphId)?.name || prototype.name} onChoose={() => onChoose(index)}>
          <DefinitionCard graphId={graphId} nodeName={prototype.name} nodeColor={color} titleDrop={TITLE_DROP} />
        </WebChoice>
      ))}
      {box && (
        <WebChoice title="New Web" onChoose={() => onChoose(prototype.definitionGraphIds?.length || 0)}>
          <WebCard nodes={[]} edges={[]} title={prototype.name} sizingName={prototype.name} color={color} newWeb titleDrop={TITLE_DROP} />
        </WebChoice>
      )}
    </div>
  );
}

export default function ThingGroupPrompt({ plusSign, setPlusSign, handleNodeSelection, leftPanelExpanded, rightPanelExpanded }) {
  const prompt = useThingGroupPromptStore(s => s.prompt);
  const prototype = useGraphStore(s => (prompt?.step === 'web' ? s.nodePrototypes.get(prompt.prototypeId) : null));

  // The plus sign it was opened from went (undone, cleared): so does the prompt.
  useEffect(() => { if (prompt && !plusSign) closeThingGroupPrompt(); }, [prompt, plusSign]);
  if (!prompt || !plusSign) return null;

  const cancel = () => {
    closeThingGroupPrompt();
    setDialogColorPickerVisible(false);
    setPlusSign(ps => ps && { ...ps, mode: 'disappear' });
  };
  // The plus sign morphs into this Thing, which opens Web `index` once landed.
  const open = (thing, index) => {
    closeThingGroupPrompt();
    setDialogColorPickerVisible(false);
    setPlusSign(ps => ps && { ...ps, openDefinition: index });
    handleNodeSelection(thing);
  };

  if (prompt.step === 'web' && prototype) {
    // The first page's layout, its Things' box holding the Webs.
    return (
      <UnifiedSelector
        key="web"
        mode="node-creation"
        isVisible={true}
        leftPanelExpanded={leftPanelExpanded}
        rightPanelExpanded={rightPanelExpanded}
        onClose={cancel}
        onBack={openThingGroupPrompt}
        title={`Open ${prototype.name || 'Thing'}`}
        subtitle="Choose the Web to open as a Thing Group."
        gridTitle="Webs"
        gridContent={<WebGrid prototype={prototype} onChoose={(index) => { haptic('menuSelect'); open(prototype, index); }} />}
      />
    );
  }

  return (
    <UnifiedSelector
      key="thing"
      mode="node-creation"
      isVisible={true}
      leftPanelExpanded={leftPanelExpanded}
      rightPanelExpanded={rightPanelExpanded}
      onClose={cancel}
      onSubmit={({ name, color }) => {
        if (!name) { cancel(); return; }
        // A new Thing has no Web yet: it opens a new one.
        closeThingGroupPrompt();
        setDialogColorPickerVisible(false);
        setPlusSign(ps => ps && { ...ps, mode: 'morph', tempName: name, selectedColor: color, openDefinition: 0 });
      }}
      onNodeSelect={(picked) => {
        const thing = useGraphStore.getState().nodePrototypes.get(picked.id) || picked;
        if (websOf(thing, useGraphStore.getState().graphs).length === 0) open(thing, 0);
        else showThingWebs(thing.id);
      }}
      title="New Thing Group"
      subtitle="Choose the Thing to open, or name a new one."
    />
  );
}
