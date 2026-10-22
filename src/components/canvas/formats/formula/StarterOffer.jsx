/**
 * The formula starter offered in New Formula's box: the bank's disciplines,
 * what each would add, and Add, with its progress while the worker builds
 * (bank/useFormulaStarter.js, the same as Settings → Data). Shown in place of
 * the list while the universe has none of the starter and no equations, and
 * after that only when asked for (the Starter choice in the box's header).
 */
import { useEffect, useRef, useState } from 'react';
import { Plus } from 'lucide-react';
import PanelIconButton from '../../../shared/PanelIconButton.jsx';
import useFormulaStarter, { count, mb } from './bank/useFormulaStarter.js';

/** How long Add, asking "Add 14?", waits for the second press. */
const CONFIRM_WINDOW_MS = 4000;

/** `first`: the universe has no equations yet. `onAdded(disciplineIds)` once they are in. */
export default function StarterOffer({ first = false, onAdded }) {
  const {
    bank, disciplines, leftOf, left, chosen, all, toggle, toggleAll,
    plan, bytes, fit, stopNote, canAdd, progress, error, add,
  } = useFormulaStarter();
  const [armed, setArmed] = useState(false);
  const timer = useRef(null);
  useEffect(() => () => clearTimeout(timer.current), []);
  // A new choice asks again.
  useEffect(() => { setArmed(false); clearTimeout(timer.current); }, [chosen]);

  const press = async () => {
    if (!armed) {
      setArmed(true);
      timer.current = setTimeout(() => setArmed(false), CONFIRM_WINDOW_MS);
      return;
    }
    clearTimeout(timer.current);
    setArmed(false);
    const ids = [...chosen];
    const result = await add();
    if (result) onAdded?.(ids);
  };

  const note = progress
    ? `Adding ${count(progress.done)} of ${count(progress.total)}…`
    : error
      || (!bank ? 'Loading…'
        : chosen.size === 0 ? 'Choose disciplines.'
          : plan.equations === 0 ? 'All here already.'
            : stopNote
              || `${count(plan.equations)} equations, about ${mb(bytes)} MB.`
                + (fit?.verdict === 'warn' ? ` GitHub sync pauses above ${mb(fit.limit)} MB.` : '')
                + " Can't be undone.");

  return (
    <div className="format-starter" aria-label="Formula Starter">
      <div className="format-bank-group-head is-static">
        <span>Formula Starter</span>
        {bank && <span className="format-bank-group-count">{count(left)}</span>}
      </div>
      <div className="format-bank-about">
        {first
          ? 'No equations here yet. Add some from Wikidata and MathModDB, or write one.'
          : 'Equations from Wikidata and MathModDB. Adds only what isn\'t here.'}
      </div>
      {bank && (
        <div className="format-starter-choices" role="group" aria-label="Disciplines to add">
          <button
            type="button" aria-pressed={all} disabled={!!progress}
            className={`format-bank-choice unified-selector-control${all ? ' is-on' : ''}`}
            onClick={toggleAll}
          >
            All
          </button>
          {disciplines.map((d) => {
            const n = leftOf(d.id);
            const on = chosen.has(d.id);
            return (
              <button
                key={d.id} type="button" aria-pressed={on} disabled={!!progress || (!n && !on)}
                className={`format-bank-choice unified-selector-control${on ? ' is-on' : ''}${n ? '' : ' is-dim'}`}
                onClick={() => toggle(d.id)}
                title={n ? `${count(n)} of ${count(d.equations.length)} not here yet` : 'All here already'}
              >
                {d.name} <span className="format-starter-count">{count(n)}</span>
              </button>
            );
          })}
        </div>
      )}
      <div className="format-starter-foot">
        <span className="format-starter-note">{note}</span>
        <PanelIconButton
          className="unified-selector-control format-starter-add"
          icon={Plus}
          size={14}
          label={progress ? 'Adding…' : armed ? `Add ${count(plan.equations)}?` : 'Add'}
          labelPosition="left"
          labelFontSize={11}
          variant="outline"
          color="maroon"
          active={armed}
          disabled={!canAdd}
          onClick={press}
          style={{ borderColor: 'maroon', flexShrink: 0 }}
        />
      </div>
      {progress && (
        <div className="format-starter-bar" role="progressbar" aria-valuemin={0} aria-valuemax={progress.total} aria-valuenow={progress.done}>
          <span style={{ width: `${progress.total ? (100 * progress.done) / progress.total : 0}%` }} />
        </div>
      )}
    </div>
  );
}
