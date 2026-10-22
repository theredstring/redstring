import { useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import PanelIconButton from '../shared/PanelIconButton.jsx';
import ActionRow from './ActionRow.jsx';
import useGraphStore from '../../store/graphStore.js';
import { loadFormulaBank, formulaBankNow, subscribeFormulaBank } from '../canvas/formats/formula/bank/formulaBank.js';
import { starterPlan, addFormulaStarter } from '../canvas/formats/formula/bank/formulaStarter.js';
import { estimateImportBytes, estimateUniverseBytes, githubFit } from '../../services/ontologyImport.js';

/**
 * Settings → Data → Formula Starter: the bank's equations added to this
 * universe as Things of its own, by discipline or all of them. Until they
 * are, New Formula only lists what the universe has (formats/formula/bank/formulaStarter.js).
 */

// What one equation costs a universe, measured on the whole bank built:
// Things, placements, webs and connections, for estimateImportBytes.
const PER_EQUATION = { things: 3.3, placements: 15.5, webs: 1.9, connections: 9.1 };

const count = (n) => Number(n || 0).toLocaleString();
const mb = (bytes) => (bytes / (1024 * 1024)).toFixed(bytes < 10 * 1024 * 1024 ? 1 : 0);
const dateOf = (iso) => {
  const d = iso ? new Date(iso) : null;
  return d && !Number.isNaN(d.getTime()) ? d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' }) : null;
};
const bytesOf = (equations) => estimateImportBytes({
  things: Math.round(equations * PER_EQUATION.things),
  placements: Math.round(equations * PER_EQUATION.placements),
  compositionWebs: Math.round(equations * PER_EQUATION.webs),
  connections: Math.round(equations * PER_EQUATION.connections),
});

/** The universe the starter goes into, as the import's GitHub check reads it; null while looking. */
function useCurrentUniverse() {
  const [current, setCurrent] = useState(null);
  useEffect(() => {
    let live = true;
    import('../../services/universeBackend.js')
      .then(({ default: universeBackend }) => {
        const active = universeBackend.getActiveUniverse?.();
        if (live) {
          setCurrent(active ? {
            gitLinked: !!(active.gitRepo?.enabled && active.gitRepo?.linkedRepo),
            hasLocalFile: !!active.localFile?.enabled,
            heldBytes: active.metadata?.gitSyncHeld?.bytes || 0,
          } : false);
        }
      })
      .catch(() => { if (live) setCurrent(false); });
    return () => { live = false; };
  }, []);
  return current;
}

export default function FormulaStarterRows({ onCloseSettings }) {
  const bank = useSyncExternalStore(subscribeFormulaBank, formulaBankNow);
  // What the universe has changes the plan: read again whenever it does.
  const prototypes = useGraphStore(s => s.nodePrototypes);
  const graphs = useGraphStore(s => s.graphs);
  const current = useCurrentUniverse();
  const [chosen, setChosen] = useState(() => new Set());
  const [progress, setProgress] = useState(null);
  const [done, setDone] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => { loadFormulaBank(); }, []);

  const disciplines = useMemo(() => (bank?.disciplines || []).filter(d => d.equations.length > 0), [bank]);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const perDiscipline = useMemo(() => new Map(disciplines.map(d => [d.id, starterPlan(bank, [d.id])])), [bank, disciplines, prototypes, graphs]);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const plan = useMemo(() => starterPlan(bank, [...chosen]), [bank, chosen, prototypes, graphs]);
  const all = disciplines.length > 0 && disciplines.every(d => chosen.has(d.id));

  const bytes = bytesOf(plan.equations);
  const fit = current && plan.equations ? githubFit(current, estimateUniverseBytes(useGraphStore.getState()), bytes) : null;
  const stops = fit?.verdict === 'refuse' || fit?.verdict === 'block';

  const toggle = (id) => {
    setDone(null);
    setError(null);
    setChosen((s) => { const next = new Set(s); if (next.has(id)) next.delete(id); else next.add(id); return next; });
  };
  const toggleAll = () => {
    setDone(null);
    setError(null);
    setChosen(all ? new Set() : new Set(disciplines.map(d => d.id)));
  };

  const add = async () => {
    setError(null);
    setDone(null);
    setProgress({ done: 0, total: plan.equations });
    try {
      const result = await addFormulaStarter([...chosen], {
        onProgress: (n, total) => setProgress({ done: n, total }),
        save: async () => {
          const { default: universeBackend } = await import('../../services/universeBackend.js');
          await universeBackend.saveActiveUniverse();
        },
      });
      setDone(result);
      setChosen(new Set());
    } catch (e) {
      setError(e?.message || String(e));
    } finally {
      setProgress(null);
    }
  };

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
            : fit?.verdict === 'refuse'
              ? `About ${mb(bytes)} MB: more than GitHub sync carries (${mb(fit.limit)} MB). Choose fewer.`
              : fit?.verdict === 'block'
                ? `This universe would be about ${mb(fit.totalBytes)} MB, over the ${mb(fit.limit)} MB GitHub sync carries, with no file on this device to keep the rest. Choose fewer.`
                : `${count(plan.equations)} equations and the ${count(plan.concepts)} things they're about, about ${mb(bytes)} MB.`
                  + (fit?.verdict === 'warn' ? ` GitHub sync pauses above ${mb(fit.limit)} MB.` : '')
                  + (plan.already ? ` ${count(plan.already)} here already.` : '')
                  + " Can't be undone, so the universe is saved first.";

  return (
    <>
      <div className="settings-section-subtitle">Formula Starter</div>
      <div className="settings-row-description" style={{ marginBottom: 8 }}>
        {`Equations from Wikidata and MathModDB${when ? `, as of ${when}` : ''}, added to this universe as Things of its own.`}
      </div>
      <div className="settings-option-group" style={{ flexWrap: 'wrap', marginBottom: 6 }}>
        <PanelIconButton label="All" labelFontSize={11} variant="outline" active={all} disabled={!bank || !!progress} onClick={toggleAll} style={{ padding: '5px 12px' }} />
        {disciplines.map((d) => {
          const left = perDiscipline.get(d.id)?.equations ?? d.equations.length;
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
        disabled={!bank || plan.equations === 0 || stops}
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
