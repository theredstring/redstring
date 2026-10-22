/**
 * Choosing and adding the formula starter, for the two places that offer it:
 * Settings → Data → Formula Starter, and New Formula's box while the universe
 * has none of it. What is left to add, its size, whether GitHub sync carries
 * it, and the add itself, with its progress (formulaStarter.js does the work).
 */
import { useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import useGraphStore from '../../../../../store/graphStore.js';
import { loadFormulaBank, formulaBankNow, subscribeFormulaBank } from './formulaBank.js';
import { starterPlan, addFormulaStarter } from './formulaStarter.js';
import { estimateImportBytes, estimateUniverseBytes, githubFit } from '../../../../../services/ontologyImport.js';

// What one equation costs a universe, measured on the whole bank built:
// Things, placements, webs and connections, for estimateImportBytes.
const PER_EQUATION = { things: 3.3, placements: 15.5, webs: 1.9, connections: 9.1 };

export const count = (n) => Number(n || 0).toLocaleString();
export const mb = (bytes) => (bytes / (1024 * 1024)).toFixed(bytes < 10 * 1024 * 1024 ? 1 : 0);

const bytesOf = (equations) => estimateImportBytes({
  things: Math.round(equations * PER_EQUATION.things),
  placements: Math.round(equations * PER_EQUATION.placements),
  compositionWebs: Math.round(equations * PER_EQUATION.webs),
  connections: Math.round(equations * PER_EQUATION.connections),
});

/** Why GitHub sync stops this add, in a sentence; null when it doesn't. */
export function starterStopNote(fit, bytes) {
  if (fit?.verdict === 'refuse') return `About ${mb(bytes)} MB: more than GitHub sync carries (${mb(fit.limit)} MB). Choose fewer.`;
  if (fit?.verdict === 'block') {
    return `This universe would be about ${mb(fit.totalBytes)} MB, over the ${mb(fit.limit)} MB GitHub sync carries, with no file on this device to keep the rest. Choose fewer.`;
  }
  return null;
}

/** The universe the starter goes into, as the import's GitHub check reads it; null while looking. */
function useCurrentUniverse() {
  const [current, setCurrent] = useState(null);
  useEffect(() => {
    let live = true;
    import('../../../../../services/universeBackend.js')
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

const saveUniverse = async () => {
  const { default: universeBackend } = await import('../../../../../services/universeBackend.js');
  await universeBackend.saveActiveUniverse();
};

export default function useFormulaStarter() {
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
  const leftOf = (id) => perDiscipline.get(id)?.equations ?? 0;
  const left = disciplines.reduce((n, d) => n + leftOf(d.id), 0);

  const bytes = bytesOf(plan.equations);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const universeBytes = useMemo(() => estimateUniverseBytes(useGraphStore.getState()), [prototypes, graphs]);
  const fit = current && plan.equations ? githubFit(current, universeBytes, bytes) : null;
  const stopNote = starterStopNote(fit, bytes);

  const fresh = () => { setDone(null); setError(null); };
  const toggle = (id) => {
    fresh();
    setChosen((s) => { const next = new Set(s); if (next.has(id)) next.delete(id); else next.add(id); return next; });
  };
  const toggleAll = () => {
    fresh();
    setChosen(all ? new Set() : new Set(disciplines.map(d => d.id)));
  };

  const add = async () => {
    fresh();
    setProgress({ done: 0, total: plan.equations });
    try {
      const result = await addFormulaStarter([...chosen], {
        onProgress: (n, total) => setProgress({ done: n, total }),
        save: saveUniverse,
      });
      setDone(result);
      setChosen(new Set());
      return result;
    } catch (e) {
      setError(e?.message || String(e));
      return null;
    } finally {
      setProgress(null);
    }
  };

  return {
    bank, disciplines, leftOf, left, chosen, all, toggle, toggleAll,
    plan, bytes, fit, stopNote, canAdd: !!bank && plan.equations > 0 && !stopNote && !progress,
    progress, done, error, add,
  };
}
