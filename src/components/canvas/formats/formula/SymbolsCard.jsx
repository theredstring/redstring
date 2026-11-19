/**
 * An equation's symbols, in its About: each letter it is written with, as
 * text, and the Thing it stands for, drawn as the panel's lists draw a Thing
 * (ThingChip: dragged out like any panel Thing, double-click opens it). A
 * letter that stands for nothing yet has an empty slot there. Swap, or a click
 * on the slot, opens the Thing picker; the Thing picked, or made there, is what
 * the letter stands for from then on (tieSymbol).
 */
import { useEffect, useRef, useState } from 'react';
import { Sigma, SendToBack } from 'lucide-react';
import { v4 as uuidv4 } from 'uuid';
import useGraphStore from '../../../../store/graphStore.js';
import useReadOnlyUniverse, { nudgeReadOnlyUniverse, selectReadOnlyOpen } from '../../../../store/readOnlyUniverse.js';
import PanelCard, { usePanelCardTokens } from '../../../shared/PanelCard.jsx';
import PanelIconButton from '../../../shared/PanelIconButton.jsx';
import { ThingChip } from '../../../wizard/EntityRows.jsx';
import useSpawnableDrag from '../../../wizard/useSpawnableDrag.js';
import { openThingInPanel } from '../../../wizard/entityActions.js';
import useDoubleTap from '../../../../hooks/useDoubleTap.js';
import UnifiedSelector from '../../../../UnifiedSelector.jsx';
import { setDialogColorPickerVisible } from '../../colorPickers/colorPickers.js';
import { NODE_DEFAULT_COLOR } from '../../../../constants.js';
import { symbolsOf } from './formulaEquations.js';
import { subscriptOf } from './formulaChain.js';
import { tieSymbol } from './tieSymbol.js';
import '../formats.css';

// Room the letter and the Swap button take beside the chip.
const LETTER_WIDTH = 34;
const LETTER_PAD = 8;
const SWAP_WIDTH = 34;
// The chip's corners, tighter than a panel list's.
const CHIP_CORNERS = 30;

function SymbolText({ text }) {
  const sub = subscriptOf(text);
  return sub ? <>{sub[0]}<sub className="formula-token-sub">{sub[1]}</sub></> : text;
}

/** The Thing a letter stands for, dragged and opened as any Thing in a panel list. */
function SymbolThing({ proto, maxWidth }) {
  const [drag, isDragging] = useSpawnableDrag({ prototypeId: proto.id, nodeName: proto.name });
  const open = () => openThingInPanel(proto.id);
  const doubleTap = useDoubleTap(open);
  return (
    <div
      ref={drag}
      className="symbols-row-thing"
      {...doubleTap}
      style={{ opacity: isDragging ? 0.5 : 1, cursor: 'grab' }}
    >
      <ThingChip id={proto.id} name={proto.name} color={proto.color} definitionGraphIds={proto.definitionGraphIds} maxWidth={maxWidth} cornerRadiusMultiplier={CHIP_CORNERS} />
    </div>
  );
}

function SymbolRow({ row, tokens, width, onChoose }) {
  const proto = useGraphStore((s) => s.nodePrototypes.get(row.protoId));
  const chipWidth = Math.max(60, width - LETTER_WIDTH - LETTER_PAD - SWAP_WIDTH);
  return (
    <div className="symbols-row">
      <span className="symbols-row-symbol" style={{ color: tokens.text, width: LETTER_WIDTH, paddingLeft: LETTER_PAD }}>
        <SymbolText text={row.symbol} />
      </span>
      {row.bare || !proto ? (
        <button
          type="button"
          className="symbols-row-empty"
          onClick={() => onChoose(row)}
          style={{ color: tokens.muted, borderColor: tokens.muted, maxWidth: chipWidth }}
        >
          Choose
        </button>
      ) : (
        <SymbolThing proto={proto} maxWidth={chipWidth} />
      )}
      <PanelIconButton
        icon={SendToBack}
        onClick={() => onChoose(row)}
        title={`Swap what ${row.symbol} stands for`}
        style={{ marginLeft: 'auto', flexShrink: 0 }}
      />
    </div>
  );
}

export default function SymbolsCard({ protoId, compact = false }) {
  const tokens = usePanelCardTokens();
  const rows = useGraphStore((s) => symbolsOf(s, protoId));
  const readOnly = useReadOnlyUniverse(selectReadOnlyOpen);
  const [choosing, setChoosing] = useState(null);
  const listRef = useRef(null);
  const [width, setWidth] = useState(240);
  const shown = rows.length > 0;
  useEffect(() => {
    const el = listRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return undefined;
    const observer = new ResizeObserver(([entry]) => setWidth(Math.floor(entry.contentRect.width)));
    observer.observe(el);
    return () => observer.disconnect();
  }, [shown]);
  if (!rows.length) return null;

  const choose = (row) => {
    if (readOnly) { nudgeReadOnlyUniverse(); return; }
    setChoosing(row);
  };
  const close = () => { setDialogColorPickerVisible(false); setChoosing(null); };

  return (
    <PanelCard title="Symbols" icon={Sigma} compact={compact}>
      <div className="symbols-list" ref={listRef}>
        {rows.map((row) => <SymbolRow key={row.key} row={row} tokens={tokens} width={width} onChoose={choose} />)}
      </div>
      {choosing && (
        <UnifiedSelector
          mode="node-creation"
          isVisible={true}
          title={`${choosing.symbol} stands for`}
          onClose={close}
          onNodeSelect={(prototype) => {
            if (prototype?.id) tieSymbol(choosing, prototype.id);
            close();
          }}
          onSubmit={({ name, color }) => {
            const trimmed = name?.trim();
            if (trimmed) {
              const id = uuidv4();
              useGraphStore.getState().addNodePrototype({
                id, name: trimmed, description: '', color: color || NODE_DEFAULT_COLOR, typeNodeId: null, definitionGraphIds: [],
              });
              tieSymbol(choosing, id);
            }
            close();
          }}
        />
      )}
    </PanelCard>
  );
}
