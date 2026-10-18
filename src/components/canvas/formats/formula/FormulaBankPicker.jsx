/**
 * The bank under New Formula (bank/formulaBank.js): disciplines to choose
 * from, then that discipline's equations, each shown as it will look. Typing
 * a title instead of a formula ("ideal gas") finds equations across the bank.
 * Picking one builds it fully formed, its symbols tied to what they mean; the
 * ones the notation can't write yet are listed, not offered.
 */
import { useMemo, useState } from 'react';
import { ChevronLeft } from 'lucide-react';
import { BANK_DISCIPLINES, bankEquations } from './bank/formulaBank.js';
import { chainFromText, tokensOf } from './formulaChain.js';
import FormulaTokens from './FormulaTokens.jsx';

const MAX_MATCHES = 6;

function readEntry(entry, standard) {
  if (entry.unsupported) return null;
  try {
    const chain = chainFromText(entry.text, {
      convention: 'math',
      isKnownName: (n) => Object.prototype.hasOwnProperty.call(entry.symbols, n),
    });
    return tokensOf(chain, { standard });
  } catch { return null; }
}

function EquationRow({ discipline, entry, standard, onPick, showDiscipline }) {
  const tokens = useMemo(() => readEntry(entry, standard), [entry, standard]);
  const disabled = !tokens;
  return (
    <button
      type="button"
      className="format-bank-row"
      disabled={disabled}
      onClick={() => onPick(discipline, entry)}
      title={disabled ? `Can't write ${entry.unsupported} yet` : `Add ${entry.title}`}
    >
      <span className="format-bank-row-title">
        {entry.title}
        {showDiscipline && <span className="format-bank-row-where">{discipline.name}</span>}
      </span>
      <span className="format-bank-row-formula">
        {tokens ? <FormulaTokens tokens={tokens} /> : <span className="format-bank-row-missing">Needs {entry.unsupported}</span>}
      </span>
    </button>
  );
}

export default function FormulaBankPicker({ query, standard, onPick }) {
  const [disciplineId, setDisciplineId] = useState(null);
  const discipline = BANK_DISCIPLINES.find(d => d.id === disciplineId) || null;

  // Typed words that aren't a formula look the bank up by title.
  const matches = useMemo(() => {
    const q = String(query || '').trim().toLowerCase();
    if (q.length < 2) return null;
    const found = bankEquations().filter(({ discipline: d, equation }) => (
      equation.title.toLowerCase().includes(q) || d.name.toLowerCase().includes(q)
    ));
    return found.length ? found.slice(0, MAX_MATCHES) : null;
  }, [query]);

  if (matches) {
    return (
      <div className="format-bank" role="list" aria-label="Equations">
        {matches.map(({ discipline: d, equation }) => (
          <EquationRow key={equation.id} discipline={d} entry={equation} standard={standard} onPick={onPick} showDiscipline />
        ))}
      </div>
    );
  }

  if (!discipline) {
    return (
      <div className="format-bank" aria-label="Disciplines">
        <div className="format-bank-grid">
          {BANK_DISCIPLINES.map(d => (
            <button key={d.id} type="button" className="format-bank-chip" onClick={() => setDisciplineId(d.id)} title={d.description}>
              {d.name}
            </button>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="format-bank" role="list" aria-label={discipline.name}>
      <div className="format-bank-head">
        <button type="button" className="format-bank-back" onClick={() => setDisciplineId(null)} aria-label="All Disciplines" title="All Disciplines">
          <ChevronLeft size={16} strokeWidth={2.75} />
        </button>
        <span>{discipline.name}</span>
      </div>
      {discipline.equations.map(entry => (
        <EquationRow key={entry.id} discipline={discipline} entry={entry} standard={standard} onPick={onPick} />
      ))}
    </div>
  );
}
