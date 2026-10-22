/**
 * "New Formula" (the canvas menu, the plus sign): the selector the plus sign
 * names a Thing with, its box holding formulas. The pill takes what is typed
 * and the colour of the equation's Thing; how it is read (Math or Code) is a
 * slider pill at the right of the box's title. The box follows what is typed:
 * this universe's equations to browse (FormulaBankPicker over
 * universeEquations.js: by discipline as the bank files them, and Yours),
 * the ones whose titles match the words, or a formula, read token by token,
 * which Enter or + builds as Things at the spot that was right-clicked
 * (buildFormula.js), shown as its formula. Picking one places that equation
 * there (formulaWizard's placeEquation). The bank itself is listed only once
 * it is added: while the universe has none of it and no equations, the box
 * offers it in place of the list (StarterOffer), then only from the Starter
 * choice in the header, as Settings → Data → Formula Starter does.
 */
import { useMemo, useRef, useState } from 'react';
import UnifiedSelector from '../../../../UnifiedSelector';
import useGraphStore from '../../../../store/graphStore.js';
import { NODE_DEFAULT_COLOR } from '../../../../constants';
import { chainFromText, tokensOf } from './formulaChain.js';
import { buildFormulaInWeb } from './buildFormula.js';
import { placeEquation } from './formulaWizard.js';
import { useUniverseEquations } from './universeEquations.js';
import FormulaTokens from './FormulaTokens.jsx';
import BankList, { BankChoices, useBankBrowse, useBankMatches, useFormulaBank } from './FormulaBankPicker.jsx';
import StarterOffer from './StarterOffer.jsx';
import { formulaStarterHere } from './bank/formulaStarter.js';
import useFormatsStore, { closeFormulaComposer, setConvention, selectStandard } from '../formatsStore.js';

const CONVENTION_OPTIONS = [
  { key: 'math', label: 'Math' },
  { key: 'programming', label: 'Code' },
];

const PLACEHOLDER = { math: 'E = mc^2, or search', programming: 'energy = mass * c**2' };

/** The names this universe already has: math reads them whole ("mc" if a Thing is called mc). */
function knownNamesNow() {
  const names = new Set();
  for (const p of useGraphStore.getState().nodePrototypes.values()) {
    if (p.isOrbitCatalog) continue;
    if (p.name) names.add(String(p.name).trim());
    if (p.labels?.formula) names.add(String(p.labels.formula).trim());
  }
  return names;
}

function ConventionSlider({ value, onChange }) {
  const index = Math.max(0, CONVENTION_OPTIONS.findIndex(o => o.key === value));
  return (
    <div className="format-slider" role="radiogroup" aria-label="Read as">
      <span
        className="format-slider-thumb"
        style={{ width: `calc((100% - 6px) / ${CONVENTION_OPTIONS.length})`, transform: `translateX(${index * 100}%)` }}
      />
      {CONVENTION_OPTIONS.map(o => (
        <button
          key={o.key}
          type="button"
          role="radio"
          aria-checked={o.key === value}
          className={`format-slider-option unified-selector-control${o.key === value ? ' is-active' : ''}`}
          onClick={() => onChange(o.key)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export default function FormulaComposer() {
  const convention = useFormatsStore(s => s.convention);
  const standard = useFormatsStore(selectStandard);
  const [draft, setDraft] = useState('');
  const color = useRef(NODE_DEFAULT_COLOR);
  const inputRef = useRef(null);
  const knownNames = useMemo(knownNamesNow, []);
  const bank = useUniverseEquations();
  const browse = useBankBrowse(bank);
  const wholeBank = useFormulaBank();
  const nodePrototypes = useGraphStore(s => s.nodePrototypes);
  // Added once already: the universe holds its Formulas Thing.
  const starterHere = useMemo(() => formulaStarterHere({ nodePrototypes }), [nodePrototypes]);
  // The bank's disciplines not all here yet: the Starter choice offers the rest.
  const moreInBank = useMemo(() => !!wholeBank && wholeBank.disciplines.some((d) => (
    d.equations.length > (bank?.disciplines.find(x => x.id === d.id)?.equations.length || 0)
  )), [wholeBank, bank]);
  const [starterOpen, setStarterOpen] = useState(false);

  const readOptions = useMemo(() => ({ convention, isKnownName: (n) => knownNames.has(n) }), [convention, knownNames]);
  // Words with no operation in them ("ideal gas") are a search of the bank, not
  // a formula, though standard math would read them as letters multiplied.
  const looksLikeWords = !!draft.trim() && !/[=+\-*/^<>≈≠≤≥×÷·√]/.test(draft);
  const parsed = useMemo(() => {
    if (!draft.trim() || looksLikeWords) return { chain: null, error: null };
    try { return { chain: chainFromText(draft, readOptions), error: null }; } catch (err) { return { chain: null, error: err.message }; }
  }, [draft, readOptions, looksLikeWords]);
  const tokens = useMemo(() => (parsed.chain ? tokensOf(parsed.chain, { standard }) : null), [parsed.chain, standard]);
  const matches = useBankMatches(bank, looksLikeWords ? draft : '');
  const first = !!bank && !starterHere && bank.disciplines.length === 0;
  const offering = !!bank && !tokens && !matches && (first || starterOpen);

  // A discipline chosen in the header closes the starter.
  const choices = { ...browse, pickDiscipline: (id) => { setStarterOpen(false); browse.pickDiscipline(id); } };
  // Added from the header: open the first of them.
  const added = (ids) => {
    setStarterOpen(false);
    if (!first && ids[0]) browse.pickDiscipline(ids[0]);
  };

  // The selector hears Enter twice (its field and the page), so whichever is
  // second finds the composer already closed and builds nothing.
  const add = ({ name }) => {
    const composing = useFormatsStore.getState().composing;
    if (!composing) return;
    buildFormulaInWeb(name, composing.graphId, composing.at, readOptions,{ color: color.current });
    closeFormulaComposer();
  };

  const pick = (discipline, entry) => {
    const composing = useFormatsStore.getState().composing;
    if (!composing) return;
    try {
      placeEquation({ graphId: composing.graphId, ref: entry.protoId, at: composing.at });
    } catch (err) {
      console.warn('[FormulaComposer] Could not place', entry.title, err);
    }
    closeFormulaComposer();
  };

  return (
    <UnifiedSelector
      mode="formula-creation"
      className="formula-selector"
      isVisible
      title="Write or choose a Formula"
      placeholder={PLACEHOLDER[convention]}
      autoFocus
      inputRef={inputRef}
      onNameChange={setDraft}
      onColorChange={(next) => { color.current = next; }}
      canSubmit={!!parsed.chain}
      submitTitle="Add to Web"
      onSubmit={add}
      onClose={closeFormulaComposer}
      headerAside={(
        <ConventionSlider
          value={convention}
          onChange={(next) => { setConvention(next); inputRef.current?.focus(); }}
        />
      )}
      headerContent={!tokens && !matches && !first ? (
        <BankChoices
          bank={bank}
          browse={choices}
          starter={moreInBank ? { on: starterOpen, toggle: () => setStarterOpen(o => !o) } : null}
        />
      ) : null}
      gridContent={tokens ? (
        <div className="formula-preview"><FormulaTokens tokens={tokens} /></div>
      ) : (
        <>
          {parsed.error && <div className="formula-preview-error">{parsed.error}</div>}
          {offering
            ? <StarterOffer first={first} onAdded={added} />
            : <BankList bank={bank} browse={browse} matches={matches} standard={standard} onPick={pick} />}
        </>
      )}
    />
  );
}
