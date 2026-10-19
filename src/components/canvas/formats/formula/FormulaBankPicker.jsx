/**
 * The bank under New Formula (bank/formulaBank.js, populated from Wikidata):
 * disciplines to choose from, then that discipline's equations, best known
 * first, each shown as it will look with its field under its title. Typing a
 * title instead of a formula ("ideal gas") finds equations across the bank.
 * Picking one builds it fully formed, its symbols tied to what they mean.
 */
import { useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { ChevronLeft } from 'lucide-react';
import { loadFormulaBank, formulaBankNow, subscribeFormulaBank } from './bank/formulaBank.js';
import { chainFromText, tokensOf } from './formulaChain.js';
import FormulaTokens from './FormulaTokens.jsx';

const MAX_MATCHES = 8;
const FIRST_SHOWN = 40; // a discipline's best known; the rest on asking

function readEntry(entry, standard) {
  try {
    const chain = chainFromText(entry.text, {
      convention: 'math',
      isKnownName: (n) => Object.prototype.hasOwnProperty.call(entry.symbols, n),
    });
    return tokensOf(chain, { standard });
  } catch { return null; }
}

function EquationRow({ discipline, entry, standard, onPick, where }) {
  const tokens = useMemo(() => readEntry(entry, standard), [entry, standard]);
  if (!tokens) return null;
  return (
    <button
      type="button"
      className="format-bank-row"
      onClick={() => onPick(discipline, entry)}
      title={entry.description}
    >
      <span className="format-bank-row-title">
        {entry.title}
        {where && <span className="format-bank-row-where">{where}</span>}
      </span>
      <span className="format-bank-row-formula"><FormulaTokens tokens={tokens} /></span>
    </button>
  );
}

/** The bank, loaded on first use, and again whenever it is updated (Settings → Data). */
function useFormulaBank() {
  const bank = useSyncExternalStore(subscribeFormulaBank, formulaBankNow);
  useEffect(() => { loadFormulaBank(); }, []);
  return bank;
}

export default function FormulaBankPicker({ query, standard, onPick }) {
  const bank = useFormulaBank();
  const [disciplineId, setDisciplineId] = useState(null);
  const [showAll, setShowAll] = useState(false);
  const discipline = bank?.disciplines.find(d => d.id === disciplineId) || null;

  // Typed words that aren't a formula look the bank up by title.
  const matches = useMemo(() => {
    const q = String(query || '').trim().toLowerCase();
    if (!bank || q.length < 2) return null;
    const found = bank.equations.filter(({ discipline: d, equation }) => (
      equation.title.toLowerCase().includes(q) || d.name.toLowerCase().includes(q)
      || (equation.field || '').toLowerCase().includes(q)
    ));
    return found.length ? found.slice(0, MAX_MATCHES) : null;
  }, [bank, query]);

  if (!bank) return <div className="format-bank format-bank-loading">Loading equations…</div>;

  if (matches) {
    return (
      <div className="format-bank" role="list" aria-label="Equations">
        {matches.map(({ discipline: d, equation }) => (
          <EquationRow key={equation.id} discipline={d} entry={equation} standard={standard} onPick={onPick} where={equation.field || d.name} />
        ))}
      </div>
    );
  }

  if (!discipline) {
    return (
      <div className="format-bank" aria-label="Disciplines">
        <div className="format-bank-grid">
          {bank.disciplines.map(d => (
            <button
              key={d.id} type="button" className="format-bank-chip"
              onClick={() => { setDisciplineId(d.id); setShowAll(false); }}
              title={`${d.equations.length} equations`}
            >
              {d.name}
            </button>
          ))}
        </div>
        <div className="format-bank-source">From Wikidata</div>
      </div>
    );
  }

  const shown = showAll ? discipline.equations : discipline.equations.slice(0, FIRST_SHOWN);
  return (
    <div className="format-bank" role="list" aria-label={discipline.name}>
      <div className="format-bank-head">
        <button type="button" className="format-bank-back" onClick={() => setDisciplineId(null)} aria-label="All Disciplines" title="All Disciplines">
          <ChevronLeft size={16} strokeWidth={2.75} />
        </button>
        <span>{discipline.name}</span>
      </div>
      {shown.map(entry => (
        <EquationRow key={entry.id} discipline={discipline} entry={entry} standard={standard} onPick={onPick} where={entry.field} />
      ))}
      {!showAll && discipline.equations.length > FIRST_SHOWN && (
        <button type="button" className="format-bank-more" onClick={() => setShowAll(true)}>
          Show all {discipline.equations.length}
        </button>
      )}
    </div>
  );
}
