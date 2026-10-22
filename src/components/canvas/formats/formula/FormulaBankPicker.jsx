/**
 * The universe's equations in New Formula's box, shaped as the bank is
 * (universeEquations.js: the bank's equations it has, filed as the bank files
 * them, and Yours), in two parts the composer puts in the selector. The box's
 * header holds every choice (BankChoices): the disciplines, then the chosen
 * discipline's sections (Thermodynamics, Graph Theory). Under it the list
 * scrolls (BankList): a discipline's equations grouped by section, best known
 * first, or one section's equations and what the bank knows of there and
 * doesn't write yet (each opening its article). Rows go side by side where
 * the box is wide. Typing a title instead of a formula ("ideal gas") finds
 * equations across them. Picking one places that equation.
 */
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import {
  loadFormulaBank, formulaBankNow, subscribeFormulaBank, loadFormulaBankKnown,
} from './bank/formulaBank.js';
import { chainFromText, tokensOf } from './formulaChain.js';
import FormulaTokens from './FormulaTokens.jsx';
import PanelIconButton from '../../../shared/PanelIconButton.jsx';
import { openExternalUrl } from '../../../../utils/safeUrl.js';
import { itemPage, isMathModDBId } from './bank/population/sources.js';
import { YOURS } from './universeEquations.js';

const MAX_MATCHES = 8;
const PER_SECTION = 4;  // a section's best known in a discipline's list; the rest in the section
const KNOWN_SHOWN = 12; // a section's known results not written yet, before "more"
const WIKIPEDIA = 'https://en.wikipedia.org/wiki/';
// A card's formula, in px: as large as this, and made smaller, down to the
// least, until it fits the card's width.
const FORMULA_SIZE = 17;
const FORMULA_LEAST = 9;

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
 * A row of choices scrolls across under a vertical wheel, never the canvas
 * behind it. Returns a ref callback, so it holds on to the element whenever
 * it appears.
 */
function useSidewaysWheel() {
  const detach = useRef(null);
  return useCallback((node) => {
    detach.current?.();
    detach.current = null;
    if (!node) return;
    const onWheel = (e) => {
      e.stopPropagation();
      if (Math.abs(e.deltaY) > Math.abs(e.deltaX)) {
        e.preventDefault();
        node.scrollLeft += e.deltaY;
      }
    };
    node.addEventListener('wheel', onWheel, { passive: false });
    detach.current = () => node.removeEventListener('wheel', onWheel);
  }, []);
}

/** A row of choices in the header, scrolled across when it is wider than the box. */
function ChoiceRow({ label, children }) {
  const wheel = useSidewaysWheel();
  return <div ref={wheel} className="format-bank-choices" role="tablist" aria-label={label}>{children}</div>;
}

function Choice({ on, dim, onClick, title, children }) {
  return (
    <button
      type="button" role="tab" aria-selected={on}
      className={`format-bank-choice unified-selector-control${on ? ' is-on' : ''}${dim ? ' is-dim' : ''}`}
      onClick={onClick} title={title}
    >
      {children}
    </button>
  );
}

/**
 * An equation's description as its row says it: the bio, less the model it is
 * part of when the row names that already.
 */
function aboutOf(entry) {
  const about = entry.description || '';
  return entry.model ? about.replace(` Part of the ${entry.model}.`, '') : about;
}

/** A card's formula on a line of its own, made smaller until the card holds all of it. */
function FittedFormula({ tokens }) {
  const box = useRef(null);
  const [size, setSize] = useState(FORMULA_SIZE);
  useLayoutEffect(() => {
    const el = box.current;
    const line = el?.firstElementChild;
    if (!el || !line) return undefined;
    const fit = () => {
      const now = parseFloat(el.style.fontSize) || FORMULA_SIZE;
      const perPx = line.offsetWidth / now;
      if (!perPx || !el.clientWidth) return;
      setSize(Math.max(FORMULA_LEAST, Math.min(FORMULA_SIZE, Math.floor((el.clientWidth / perPx) * 4) / 4)));
    };
    fit();
    const observer = new ResizeObserver(fit);
    observer.observe(el);
    return () => observer.disconnect();
  }, [tokens]);
  return (
    <span ref={box} className="format-bank-row-formula" style={{ fontSize: `${size}px` }}>
      <FormulaTokens tokens={tokens} />
    </span>
  );
}

/**
 * The panels' outlined pill under a list: Show More lengthens it where it is;
 * a section's pill (`label`, ChevronRight) opens the section instead, and says so.
 */
function MorePill({ label, icon = ChevronDown, onClick }) {
  return (
    <div className="format-bank-more">
      <PanelIconButton
        className="unified-selector-control"
        icon={icon}
        size={14}
        label={label}
        labelPosition="left"
        labelFontSize={11}
        variant="outline"
        color="maroon"
        onClick={onClick}
        style={{ borderColor: 'maroon' }}
      />
    </div>
  );
}

/** `where`: the section it is in, when listed apart from it (a search); else the model it is part of. */
function EquationRow({ discipline, entry, standard, onPick, where }) {
  const tokens = useMemo(() => readEntry(entry, standard), [entry, standard]);
  if (!tokens) return null;
  const note = where || entry.model;
  const about = aboutOf(entry);
  return (
    <button
      type="button"
      className="format-bank-row unified-selector-card"
      onClick={() => onPick(discipline, entry)}
      title={entry.description}
    >
      <span className="format-bank-row-title">
        {entry.title}
        {note && <span className="format-bank-row-where">{note}</span>}
        {about && <span className="format-bank-row-about">{about}</span>}
      </span>
      <FittedFormula tokens={tokens} />
    </button>
  );
}

/** The bank, loaded on first use, and again whenever it is updated (Settings → Data). */
export function useFormulaBank() {
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
      <div className="format-bank-rows">
      {list.slice(0, shown).map(([q, title, article, why, about]) => (
        <button
          key={q}
          type="button"
          className="format-bank-known-row unified-selector-card"
          onClick={() => openExternalUrl(article ? `${WIKIPEDIA}${encodeURIComponent(article.replace(/ /g, '_'))}` : itemPage(q))}
          title={article ? `Open ${article} on Wikipedia` : isMathModDBId(q) ? 'Open it on MathModDB' : `Open ${q} on Wikidata`}
        >
          <span className="format-bank-known-head">
            <span className="format-bank-known-title">{title}</span>
            <span className="format-bank-known-why">{why}</span>
          </span>
          {about && <span className="format-bank-known-about">{about}</span>}
        </button>
      ))}
      </div>
      {list.length > shown && (
        <MorePill label={`Show More (${list.length - shown})`} onClick={() => setShown(s => s + KNOWN_SHOWN * 4)} />
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
          <div className="format-bank-rows">
            {entries.slice(0, PER_SECTION).map(entry => (
              <EquationRow key={entry.id} discipline={discipline} entry={entry} standard={standard} onPick={onPick} />
            ))}
          </div>
          {entries.length > PER_SECTION && (
            <MorePill label={`All of ${section.name} (${entries.length})`} icon={ChevronRight} onClick={() => onSection(section.id)} />
          )}
        </div>
      ))}
      {groups.rest.length > 0 && (
        <div className="format-bank-group">
          <div className="format-bank-group-head is-static">
            <span>{groups.sections.length ? 'Not in a section' : discipline.name}</span>
            <span className="format-bank-group-count">{groups.rest.length}</span>
          </div>
          <div className="format-bank-rows">
            {groups.rest.slice(0, restShown).map(entry => (
              <EquationRow key={entry.id} discipline={discipline} entry={entry} standard={standard} onPick={onPick} />
            ))}
          </div>
          {groups.rest.length > restShown && (
            <MorePill label={`Show More (${groups.rest.length - restShown})`} onClick={() => setRestShown(n => n + PER_SECTION * 10)} />
          )}
        </div>
      )}
    </>
  );
}

/** Which discipline and section are open. The largest discipline is open to start with. */
export function useBankBrowse(bank) {
  const [disciplineId, setDisciplineId] = useState(null);
  const [sectionId, setSectionId] = useState(null);
  const discipline = bank?.disciplines.find(d => d.id === disciplineId) || bank?.disciplines[0] || null;
  const section = discipline?.sections?.find(x => x.id === sectionId) || null;
  const pickDiscipline = useCallback((id) => { setDisciplineId(id); setSectionId(null); }, []);
  return { discipline, section, pickDiscipline, pickSection: setSectionId };
}

/** Typed words that aren't a formula look the bank up by title; null when they find nothing. */
export function useBankMatches(bank, query) {
  return useMemo(() => {
    const q = String(query || '').trim().toLowerCase();
    if (!bank || q.length < 2) return null;
    const found = bank.equations.filter(({ discipline: d, equation }) => (
      equation.title.toLowerCase().includes(q) || d.name.toLowerCase().includes(q)
      || (equation.section || '').toLowerCase().includes(q)
      || (equation.model || '').toLowerCase().includes(q)
    ));
    return found.length ? found.slice(0, MAX_MATCHES) : null;
  }, [bank, query]);
}

/** The disciplines, then the open one's sections: the box's header. */
export function BankChoices({ bank, browse }) {
  const { discipline, section, pickDiscipline, pickSection } = browse;
  if (!bank) return null;
  // Sections with equations first; the ones that only know of results after, dimmer.
  const sections = [...(discipline?.sections || [])].sort((a, b) => (b.equations > 0) - (a.equations > 0));
  return (
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
          <Choice on={!section} onClick={() => pickSection(null)} title={`All of ${discipline.name}`}>All</Choice>
          {sections.map(x => (
            <Choice
              key={x.id} on={x.id === section?.id} dim={!x.equations} onClick={() => pickSection(x.id)}
              title={`${x.equations} equations${x.missing ? `, ${x.missing} known not written yet` : ''}`}
            >
              {x.name}
            </Choice>
          ))}
        </ChoiceRow>
      )}
    </div>
  );
}

/** The list: what the typed words found, else the open section or discipline. Scrolled by the box. */
export default function BankList({ bank, browse, matches, standard, onPick }) {
  const { discipline, section, pickSection } = browse;
  const ref = useRef(null);
  // A new choice starts its list at the top.
  useEffect(() => {
    const scroller = ref.current?.closest('.unified-selector-scroll');
    if (scroller) scroller.scrollTop = 0;
  }, [discipline?.id, section?.id]);

  if (!bank) return <div className="format-bank-body"><div className="format-bank-loading">Loading equations…</div></div>;
  if (!bank.disciplines.length) {
    return (
      <div className="format-bank-body">
        <div className="format-bank-loading">No equations in this universe yet. Write one, or add the Formula Starter (Settings → Data).</div>
      </div>
    );
  }
  // Credited where what is listed came from them.
  const fromBank = bank.disciplines.some(d => d.id !== YOURS);

  return (
    <div ref={ref} className="format-bank-body" role="list" aria-label="Equations in this universe">
      {matches ? (
        <div className="format-bank-rows">
          {matches.map(({ discipline: d, equation }) => (
            <EquationRow key={equation.id} discipline={d} entry={equation} standard={standard} onPick={onPick} where={equation.section || d.name} />
          ))}
        </div>
      ) : section ? (
        <>
          {section.description && <div className="format-bank-about">{section.description}</div>}
          <div className="format-bank-rows">
            {discipline.equations.filter(e => e.sectionId === section.id).map(entry => (
              <EquationRow key={entry.id} discipline={discipline} entry={entry} standard={standard} onPick={onPick} />
            ))}
          </div>
          {!section.equations && <div className="format-bank-loading">No equations written here yet.</div>}
          <KnownInSection bank={bank} discipline={discipline} section={section} />
        </>
      ) : discipline && discipline.equations.length ? (
        <GroupedBySection key={discipline.id} discipline={discipline} standard={standard} onPick={onPick} onSection={pickSection} />
      ) : (
        <div className="format-bank-loading">No equations written here yet. Its sections say what they know of.</div>
      )}
      {fromBank && <div className="format-bank-source">From Wikidata and MathModDB (CC BY 4.0)</div>}
    </div>
  );
}
