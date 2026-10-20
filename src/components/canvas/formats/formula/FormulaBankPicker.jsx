/**
 * The bank under New Formula (bank/formulaBank.js, populated from Wikidata):
 * disciplines to choose from, then that discipline's equations, best known
 * first, each shown as it will look with its section under its title. A
 * discipline is divided into sections (Thermodynamics, Graph Theory) to narrow
 * it to; a section also lists what it knows of and the bank doesn't write
 * yet, each opening its article. Typing a title instead of a formula ("ideal
 * gas") finds equations across the bank. Picking one builds it fully formed,
 * its symbols tied to what they mean.
 */
import { useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { ChevronLeft } from 'lucide-react';
import {
  loadFormulaBank, formulaBankNow, subscribeFormulaBank, loadFormulaBankKnown,
} from './bank/formulaBank.js';
import { chainFromText, tokensOf } from './formulaChain.js';
import FormulaTokens from './FormulaTokens.jsx';
import { openExternalUrl } from '../../../../utils/safeUrl.js';

const MAX_MATCHES = 8;
const FIRST_SHOWN = 40; // a discipline's best known; the rest on asking
const KNOWN_SHOWN = 12; // a section's known results not written yet, before "more"
const WIKIPEDIA = 'https://en.wikipedia.org/wiki/';
const WIKIDATA = 'https://www.wikidata.org/wiki/';

function readEntry(entry, standard) {
  try {
    const chain = chainFromText(entry.text, {
      convention: 'math',
      isKnownName: (n) => Object.prototype.hasOwnProperty.call(entry.symbols, n) || !!entry.placeHolders?.includes(n),
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

/** What a section knows of and the bank doesn't write yet, loaded on opening it. */
function KnownInSection({ bank, discipline, section }) {
  const [list, setList] = useState(null);
  const [shown, setShown] = useState(KNOWN_SHOWN);
  useEffect(() => {
    let live = true;
    setList(null);
    setShown(KNOWN_SHOWN);
    loadFormulaBankKnown()
      .then((known) => { if (live) setList(known?.sections?.[`${discipline.id}/${section.id}`] || []); })
      .catch(() => { if (live) setList([]); });
    return () => { live = false; };
  }, [bank, discipline.id, section.id]);
  if (!list?.length) return null;
  return (
    <div className="format-bank-known" aria-label="Known, not written yet">
      <div className="format-bank-known-head">Known, not written yet</div>
      {list.slice(0, shown).map(([q, title, article, why]) => (
        <button
          key={q}
          type="button"
          className="format-bank-known-row"
          onClick={() => openExternalUrl(article ? `${WIKIPEDIA}${encodeURIComponent(article.replace(/ /g, '_'))}` : `${WIKIDATA}${q}`)}
          title={article ? `Open ${article} on Wikipedia` : `Open ${q} on Wikidata`}
        >
          <span className="format-bank-known-title">{title}</span>
          <span className="format-bank-known-why">{why}</span>
        </button>
      ))}
      {list.length > shown && (
        <button type="button" className="format-bank-more" onClick={() => setShown(s => s + KNOWN_SHOWN * 4)}>
          {`${list.length - shown} more`}
        </button>
      )}
    </div>
  );
}

export default function FormulaBankPicker({ query, standard, onPick }) {
  const bank = useFormulaBank();
  const [disciplineId, setDisciplineId] = useState(null);
  const [sectionId, setSectionId] = useState(null);
  const [showAll, setShowAll] = useState(false);
  const [allSections, setAllSections] = useState(false);
  const discipline = bank?.disciplines.find(d => d.id === disciplineId) || null;
  const section = discipline?.sections?.find(x => x.id === sectionId) || null;

  // Typed words that aren't a formula look the bank up by title.
  const matches = useMemo(() => {
    const q = String(query || '').trim().toLowerCase();
    if (!bank || q.length < 2) return null;
    const found = bank.equations.filter(({ discipline: d, equation }) => (
      equation.title.toLowerCase().includes(q) || d.name.toLowerCase().includes(q)
      || (equation.section || '').toLowerCase().includes(q)
    ));
    return found.length ? found.slice(0, MAX_MATCHES) : null;
  }, [bank, query]);

  if (!bank) return <div className="format-bank format-bank-loading">Loading equations…</div>;

  if (matches) {
    return (
      <div className="format-bank" role="list" aria-label="Equations">
        {matches.map(({ discipline: d, equation }) => (
          <EquationRow key={equation.id} discipline={d} entry={equation} standard={standard} onPick={onPick} where={equation.section || d.name} />
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
              onClick={() => { setDisciplineId(d.id); setSectionId(null); setShowAll(false); setAllSections(false); }}
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

  const sections = discipline.sections || [];
  // Sections with equations first; the ones that only know of results on asking.
  const written = sections.filter(x => x.equations > 0);
  const sectionChips = allSections || !written.length ? sections : written;
  const inView = section ? discipline.equations.filter(e => e.sectionId === section.id) : discipline.equations;
  const shown = showAll || section ? inView : inView.slice(0, FIRST_SHOWN);
  return (
    <div className="format-bank" role="list" aria-label={section ? `${discipline.name}: ${section.name}` : discipline.name}>
      <div className="format-bank-head">
        <button
          type="button" className="format-bank-back"
          onClick={() => (section ? setSectionId(null) : setDisciplineId(null))}
          aria-label={section ? `All of ${discipline.name}` : 'All Disciplines'}
          title={section ? `All of ${discipline.name}` : 'All Disciplines'}
        >
          <ChevronLeft size={16} strokeWidth={2.75} />
        </button>
        <span>{section ? `${discipline.name}: ${section.name}` : discipline.name}</span>
      </div>
      {!section && sections.length > 0 && (
        <div className="format-bank-sections" aria-label="Sections">
          {sectionChips.map(x => (
            <button
              key={x.id} type="button" className="format-bank-section"
              onClick={() => setSectionId(x.id)}
              title={`${x.equations} equations${x.missing ? `, ${x.missing} known not written yet` : ''}`}
            >
              {x.name}
            </button>
          ))}
          {sectionChips.length < sections.length && (
            <button type="button" className="format-bank-section is-more" onClick={() => setAllSections(true)}>
              {`${sections.length - sectionChips.length} more`}
            </button>
          )}
        </div>
      )}
      {shown.map(entry => (
        <EquationRow key={entry.id} discipline={discipline} entry={entry} standard={standard} onPick={onPick} where={section ? null : entry.section} />
      ))}
      {!shown.length && <div className="format-bank-loading">No equations written here yet.</div>}
      {!showAll && !section && inView.length > FIRST_SHOWN && (
        <button type="button" className="format-bank-more" onClick={() => setShowAll(true)}>
          Show all {inView.length}
        </button>
      )}
      {section && <KnownInSection bank={bank} discipline={discipline} section={section} />}
    </div>
  );
}
