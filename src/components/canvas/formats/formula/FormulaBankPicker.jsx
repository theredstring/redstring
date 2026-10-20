/**
 * The bank under New Formula (bank/formulaBank.js, populated from Wikidata and MathModDB).
 * A fixed header holds every choice: the disciplines, then the chosen
 * discipline's sections (Thermodynamics, Graph Theory). Under it the list
 * scrolls: a discipline's equations grouped by section, best known first, or
 * one section's equations and what it knows of and doesn't write yet (each
 * opening its article). Typing a title instead of a formula ("ideal gas")
 * finds equations across the bank. Picking one builds it fully formed, its
 * symbols tied to what they mean.
 */
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import {
  loadFormulaBank, formulaBankNow, subscribeFormulaBank, loadFormulaBankKnown,
} from './bank/formulaBank.js';
import { chainFromText, tokensOf } from './formulaChain.js';
import FormulaTokens from './FormulaTokens.jsx';
import { openExternalUrl } from '../../../../utils/safeUrl.js';
import { itemPage, isMathModDBId } from './bank/population/sources.js';

const MAX_MATCHES = 8;
const PER_SECTION = 4;  // a section's best known in a discipline's list; the rest in the section
const KNOWN_SHOWN = 12; // a section's known results not written yet, before "more"
const WIKIPEDIA = 'https://en.wikipedia.org/wiki/';

function readEntry(entry, standard) {
  try {
    const chain = chainFromText(entry.text, {
      convention: 'math',
      isKnownName: (n) => Object.prototype.hasOwnProperty.call(entry.symbols, n) || !!entry.placeHolders?.includes(n),
    });
    return tokensOf(chain, { standard });
  } catch { return null; }
}

/**
 * The wheel scrolls what it is over, never the canvas behind it (whose own
 * wheel handling pans and zooms). `sideways`: a row of choices, which a
 * vertical wheel scrolls across. Returns a ref callback, so it holds on to
 * the element whenever it appears (the list isn't there while the bank loads).
 */
function useOwnWheel(sideways = false) {
  const detach = useRef(null);
  return useCallback((node) => {
    detach.current?.();
    detach.current = null;
    if (!node) return;
    const onWheel = (e) => {
      e.stopPropagation();
      if (sideways && Math.abs(e.deltaY) > Math.abs(e.deltaX)) {
        e.preventDefault();
        node.scrollLeft += e.deltaY;
      }
    };
    node.addEventListener('wheel', onWheel, { passive: false });
    detach.current = () => node.removeEventListener('wheel', onWheel);
  }, [sideways]);
}

/** A row of choices in the header, scrolled across when it is wider than the box. */
function ChoiceRow({ label, children }) {
  const wheel = useOwnWheel(true);
  return <div ref={wheel} className="format-bank-choices" role="tablist" aria-label={label}>{children}</div>;
}

function Choice({ on, dim, onClick, title, children }) {
  return (
    <button
      type="button" role="tab" aria-selected={on}
      className={`format-bank-choice${on ? ' is-on' : ''}${dim ? ' is-dim' : ''}`}
      onClick={onClick} title={title}
    >
      {children}
    </button>
  );
}

/** `where`: the section it is in, when listed apart from it (a search); else the model it is part of. */
function EquationRow({ discipline, entry, standard, onPick, where }) {
  const tokens = useMemo(() => readEntry(entry, standard), [entry, standard]);
  if (!tokens) return null;
  const note = where || entry.model;
  return (
    <button
      type="button"
      className="format-bank-row"
      onClick={() => onPick(discipline, entry)}
      title={entry.description}
    >
      <span className="format-bank-row-title">
        {entry.title}
        {note && <span className="format-bank-row-where">{note}</span>}
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
      <div className="format-bank-group-head is-static">
        <span>Known, not written yet</span>
        <span className="format-bank-group-count">{list.length}</span>
      </div>
      {list.slice(0, shown).map(([q, title, article, why]) => (
        <button
          key={q}
          type="button"
          className="format-bank-known-row"
          onClick={() => openExternalUrl(article ? `${WIKIPEDIA}${encodeURIComponent(article.replace(/ /g, '_'))}` : itemPage(q))}
          title={article ? `Open ${article} on Wikipedia` : isMathModDBId(q) ? 'Open it on MathModDB' : `Open ${q} on Wikidata`}
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

/** A discipline's equations, each section under its own heading, the rest last. */
function GroupedBySection({ discipline, standard, onPick, onSection }) {
  const groups = useMemo(() => {
    const bySection = new Map((discipline.sections || []).filter(x => x.equations > 0).map(x => [x.id, { section: x, entries: [] }]));
    const rest = [];
    for (const e of discipline.equations) (bySection.get(e.sectionId)?.entries || rest).push(e);
    return { sections: [...bySection.values()].filter(g => g.entries.length), rest };
  }, [discipline]);
  const [restShown, setRestShown] = useState(PER_SECTION * 3);
  return (
    <>
      {groups.sections.map(({ section, entries }) => (
        <div key={section.id} className="format-bank-group">
          <button type="button" className="format-bank-group-head" onClick={() => onSection(section.id)} title={`All of ${section.name}`}>
            <span>{section.name}</span>
            <span className="format-bank-group-count">{entries.length}</span>
          </button>
          {entries.slice(0, PER_SECTION).map(entry => (
            <EquationRow key={entry.id} discipline={discipline} entry={entry} standard={standard} onPick={onPick} />
          ))}
          {entries.length > PER_SECTION && (
            <button type="button" className="format-bank-more" onClick={() => onSection(section.id)}>
              {`${entries.length - PER_SECTION} more in ${section.name}`}
            </button>
          )}
        </div>
      ))}
      {groups.rest.length > 0 && (
        <div className="format-bank-group">
          <div className="format-bank-group-head is-static">
            <span>{groups.sections.length ? 'Not in a section' : discipline.name}</span>
            <span className="format-bank-group-count">{groups.rest.length}</span>
          </div>
          {groups.rest.slice(0, restShown).map(entry => (
            <EquationRow key={entry.id} discipline={discipline} entry={entry} standard={standard} onPick={onPick} />
          ))}
          {groups.rest.length > restShown && (
            <button type="button" className="format-bank-more" onClick={() => setRestShown(n => n + PER_SECTION * 10)}>
              {`${groups.rest.length - restShown} more`}
            </button>
          )}
        </div>
      )}
    </>
  );
}

export default function FormulaBankPicker({ query, standard, onPick }) {
  const bank = useFormulaBank();
  const [disciplineId, setDisciplineId] = useState(null);
  const [sectionId, setSectionId] = useState(null);
  const bodyRef = useRef(null);
  const bodyWheel = useOwnWheel();
  const body = useCallback((node) => { bodyRef.current = node; bodyWheel(node); }, [bodyWheel]);
  // The largest discipline is open to start with: the header's first choice already made.
  const discipline = bank?.disciplines.find(d => d.id === disciplineId) || bank?.disciplines[0] || null;
  const section = discipline?.sections?.find(x => x.id === sectionId) || null;
  // A new choice starts its list at the top.
  useEffect(() => { if (bodyRef.current) bodyRef.current.scrollTop = 0; }, [discipline?.id, section?.id]);

  // Typed words that aren't a formula look the bank up by title.
  const matches = useMemo(() => {
    const q = String(query || '').trim().toLowerCase();
    if (!bank || q.length < 2) return null;
    const found = bank.equations.filter(({ discipline: d, equation }) => (
      equation.title.toLowerCase().includes(q) || d.name.toLowerCase().includes(q)
      || (equation.section || '').toLowerCase().includes(q)
      || (equation.model || '').toLowerCase().includes(q)
    ));
    return found.length ? found.slice(0, MAX_MATCHES) : null;
  }, [bank, query]);

  if (!bank) return <div className="format-bank"><div className="format-bank-loading">Loading equations…</div></div>;

  // Sections with equations first; the ones that only know of results after, dimmer.
  const sections = [...(discipline?.sections || [])].sort((a, b) => (b.equations > 0) - (a.equations > 0));
  const pickDiscipline = (id) => { setDisciplineId(id); setSectionId(null); };

  return (
    <div className="format-bank" aria-label="Equations from Wikidata and MathModDB">
      {!matches && (
        <div className="format-bank-top">
          <ChoiceRow label="Disciplines">
            {bank.disciplines.map(d => (
              <Choice key={d.id} on={d.id === discipline?.id} dim={!d.equations.length} onClick={() => pickDiscipline(d.id)} title={`${d.equations.length} equations`}>
                {d.name}
              </Choice>
            ))}
          </ChoiceRow>
          {sections.length > 0 && (
            <ChoiceRow label="Sections">
              <Choice on={!section} onClick={() => setSectionId(null)} title={`All of ${discipline.name}`}>All</Choice>
              {sections.map(x => (
                <Choice
                  key={x.id} on={x.id === section?.id} dim={!x.equations} onClick={() => setSectionId(x.id)}
                  title={`${x.equations} equations${x.missing ? `, ${x.missing} known not written yet` : ''}`}
                >
                  {x.name}
                </Choice>
              ))}
            </ChoiceRow>
          )}
        </div>
      )}
      <div ref={body} className="format-bank-body" role="list">
        {matches ? matches.map(({ discipline: d, equation }) => (
          <EquationRow key={equation.id} discipline={d} entry={equation} standard={standard} onPick={onPick} where={equation.section || d.name} />
        )) : section ? (
          <>
            {discipline.equations.filter(e => e.sectionId === section.id).map(entry => (
              <EquationRow key={entry.id} discipline={discipline} entry={entry} standard={standard} onPick={onPick} />
            ))}
            {!section.equations && <div className="format-bank-loading">No equations written here yet.</div>}
            <KnownInSection bank={bank} discipline={discipline} section={section} />
          </>
        ) : discipline && discipline.equations.length ? (
          <GroupedBySection key={discipline.id} discipline={discipline} standard={standard} onPick={onPick} onSection={setSectionId} />
        ) : (
          <div className="format-bank-loading">No equations written here yet. Its sections say what they know of.</div>
        )}
        <div className="format-bank-source">From Wikidata and MathModDB (CC BY 4.0)</div>
      </div>
    </div>
  );
}
