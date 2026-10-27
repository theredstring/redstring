import PanelIconButton from '../shared/PanelIconButton.jsx';
import ActionRow from './ActionRow.jsx';
import useGraphStore from '../../store/graphStore.js';
import useFormulaStarter, { count, mb } from '../canvas/formats/formula/bank/useFormulaStarter.js';

/**
 * Settings → Data → Formula Starter: the bank's equations added to this
 * universe as Things of its own, by discipline or all of them. Until they
 * are, New Formula only lists what the universe has, and offers them
 * (formats/formula/bank/formulaStarter.js). Adding again adds only what isn't here.
 */

const dateOf = (iso) => {
  const d = iso ? new Date(iso) : null;
  return d && !Number.isNaN(d.getTime()) ? d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' }) : null;
};

export default function FormulaStarterRows({ onCloseSettings }) {
  const {
    bank, disciplines, leftOf, chosen, all, toggle, toggleAll,
    plan, bytes, fit, stopNote, progress, done, error, add,
  } = useFormulaStarter();

  const when = dateOf(bank?.fetchedAt);
  const description = progress
    ? `Adding ${count(progress.done)} of ${count(progress.total)}…`
    : error
      ? error
      : !bank
        ? 'Loading…'
        : chosen.size === 0
          ? 'Choose disciplines above'
          : plan.equations === 0
            ? 'All of those are here already'
            : stopNote
              ? stopNote
              : `${count(plan.equations)} equations and the ${count(plan.concepts)} things they're about, about ${mb(bytes)} MB.`
                + (fit?.verdict === 'warn' ? ` GitHub sync pauses above ${mb(fit.limit)} MB.` : '')
                + (plan.already ? ` ${count(plan.already)} here already, skipped.` : '')
                + " Can't be undone, so the universe is saved first.";

  return (
    <>
      <div className="settings-section-subtitle">Formula Starter</div>
      <div className="settings-row-description" style={{ marginBottom: 8 }}>
        {`Equations from Wikidata and MathModDB${when ? `, as of ${when}` : ''}, added to this universe as Things of its own. Adding again skips what's here.`}
      </div>
      <div className="settings-option-group" style={{ flexWrap: 'wrap', justifyContent: 'flex-start', marginBottom: 6 }}>
        <PanelIconButton label="All" labelFontSize={11} variant="outline" active={all} disabled={!bank || !!progress} onClick={toggleAll} style={{ padding: '5px 12px' }} />
        {disciplines.map((d) => {
          const left = leftOf(d.id);
          return (
            <PanelIconButton
              key={d.id}
              label={`${d.name} ${count(left)}`}
              labelFontSize={11}
              variant="outline"
              active={chosen.has(d.id)}
              disabled={!!progress}
              title={left ? `${count(left)} of ${count(d.equations.length)} not here yet` : 'All here already'}
              onClick={() => toggle(d.id)}
              style={{ padding: '5px 12px', opacity: left ? 1 : 0.5 }}
            />
          );
        })}
      </div>
      <ActionRow
        title="Add to This Universe"
        description={description}
        actionLabel="Add"
        confirmLabel={`Add ${count(plan.equations)}?`}
        busy={!!progress}
        busyLabel="Adding…"
        disabled={!bank || plan.equations === 0 || !!stopNote}
        onClick={add}
      />
      {done?.rootWebId && (
        <ActionRow
          title="Formulas"
          description={`Added ${count(done.added)} equations${done.skipped?.length ? `; ${count(done.skipped.length)} couldn't be built` : ''}`}
          actionLabel="Open"
          onClick={() => {
            useGraphStore.getState().openGraphTabAndBringToTop(done.rootWebId);
            onCloseSettings?.();
          }}
        />
      )}
    </>
  );
}
