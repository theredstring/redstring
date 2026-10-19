import { useEffect, useState, useSyncExternalStore } from 'react';
import { ChevronRight } from 'lucide-react';
import ActionRow from './ActionRow.jsx';
import { useTheme } from '../../hooks/useTheme.js';
import { openExternalUrl } from '../../utils/safeUrl.js';
import {
  loadFormulaBank, formulaBankNow, subscribeFormulaBank, loadFormulaBankReport, restoreBuiltInFormulaBank,
} from '../canvas/formats/formula/bank/formulaBank.js';
import {
  getFormulaBankUpdate, subscribeFormulaBankUpdate, updateFormulaBankFromWikidata, stopFormulaBankUpdate,
} from '../canvas/formats/formula/bank/population/updateFormulaBank.js';

/**
 * Settings → Data → Formula Bank: where the equations New Formula offers come
 * from, updating them from Wikidata on this device, and what was left out of
 * them and why. The bank is populated, never written by hand
 * (formats/formula/bank/formulaBank.js); this is where that shows.
 */

const ITEMS_SHOWN = 60;
const WIKIDATA_ITEM = 'https://www.wikidata.org/wiki/';
const count = (n) => Number(n || 0).toLocaleString();
const dateOf = (iso) => {
  const d = iso ? new Date(iso) : null;
  return d && !Number.isNaN(d.getTime()) ? d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' }) : null;
};

/** One reason things were left out, opening to the items it left out. */
function Reason({ reason, n, items, theme }) {
  const [open, setOpen] = useState(false);
  const [shown, setShown] = useState(ITEMS_SHOWN);
  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        aria-expanded={open}
        style={{
          display: 'flex', alignItems: 'center', gap: 6, width: '100%', padding: '6px 0', border: 'none',
          background: 'none', color: theme.canvas.textPrimary, font: 'inherit', fontSize: '0.78rem', cursor: 'pointer', textAlign: 'left',
        }}
      >
        <ChevronRight size={14} style={{ transform: open ? 'rotate(90deg)' : 'none', transition: 'transform 0.15s', flexShrink: 0 }} />
        <span style={{ flex: 1 }}>{reason[0].toUpperCase() + reason.slice(1)}</span>
        <span style={{ color: theme.canvas.textSecondary }}>{count(n)}</span>
      </button>
      {open && (
        <div style={{ padding: '0 0 6px 20px' }}>
          {items.slice(0, shown).map(item => (
            <button
              key={item.id}
              type="button"
              className="formula-bank-left-out"
              onClick={() => openExternalUrl(`${WIKIDATA_ITEM}${item.id}`)}
              title={`Open ${item.id} on Wikidata`}
              style={{
                display: 'block', width: '100%', padding: '3px 0', border: 'none', background: 'none', cursor: 'pointer',
                textAlign: 'left', font: 'inherit', fontSize: '0.74rem', color: theme.canvas.textPrimary,
              }}
            >
              {item.label || item.id}
              {item.detail && <span style={{ color: theme.canvas.textSecondary }}>{` — ${item.detail}`}</span>}
            </button>
          ))}
          {items.length > shown && (
            <button
              type="button"
              onClick={() => setShown(s => s + ITEMS_SHOWN * 4)}
              style={{ border: 'none', background: 'none', padding: '4px 0', cursor: 'pointer', font: 'inherit', fontSize: '0.74rem', fontWeight: 'bold', color: theme.canvas.brandText }}
            >
              {`${count(items.length - shown)} more`}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

/** What the current bank took in, and every item it left out, by why. */
function LeftOut({ theme }) {
  const [report, setReport] = useState(null);
  useEffect(() => {
    let live = true;
    loadFormulaBankReport().then((r) => { if (live) setReport(r); }).catch(() => { if (live) setReport(false); });
    return () => { live = false; };
  }, []);
  if (report === null) return <div className="settings-row-description" style={{ padding: '4px 0 10px' }}>Loading…</div>;
  if (!report) return <div className="settings-row-description" style={{ padding: '4px 0 10px' }}>No report for this bank.</div>;
  const byReason = new Map();
  for (const r of report.rejected) {
    if (!byReason.has(r.reason)) byReason.set(r.reason, []);
    byReason.get(r.reason).push(r);
  }
  return (
    <div style={{ padding: '2px 0 12px' }}>
      <div className="settings-row-description" style={{ marginBottom: 6 }}>
        {`In: ${count(report.accepted)} of ${count(report.total)}. `}
        {report.byDiscipline.map(([d, n]) => `${d} ${count(n)}`).join(', ')}
      </div>
      {report.byReason.map(([reason, n]) => (
        <Reason key={reason} reason={reason} n={n} items={byReason.get(reason) || []} theme={theme} />
      ))}
    </div>
  );
}

export default function FormulaBankRows() {
  const theme = useTheme();
  const bank = useSyncExternalStore(subscribeFormulaBank, formulaBankNow);
  const update = useSyncExternalStore(subscribeFormulaBankUpdate, getFormulaBankUpdate);
  const [showLeftOut, setShowLeftOut] = useState(false);
  const [restoreNote, setRestoreNote] = useState(null);

  useEffect(() => { loadFormulaBank(); }, []);

  const equations = bank ? bank.equations.length : null;
  const when = dateOf(bank?.fetchedAt);
  const status = update.running
    ? `${update.stage}${update.total ? ` ${count(update.done)} of ${count(update.total)}` : '…'}`
    : update.error
      ? update.error
      : update.result
        ? `Updated: ${count(update.result.accepted)} of ${count(update.result.total)} items are in${update.result.kept ? '' : '. Not kept on this device: storage is off.'}`
        : bank
          ? `${count(equations)} from Wikidata, ${bank.from === 'device' ? 'updated on this device' : 'with the app'}${when ? `, ${when}` : ''}`
          : 'Loading…';

  return (
    <>
      <div className="settings-section-subtitle">Formula Bank</div>
      <ActionRow
        title="Update from Wikidata"
        description={status}
        actionLabel={update.running ? 'Stop' : 'Update'}
        onClick={update.running ? stopFormulaBankUpdate : updateFormulaBankFromWikidata}
      />
      <ActionRow
        title="Left Out"
        description={bank ? 'What didn\'t get in, and why' : null}
        actionLabel={showLeftOut ? 'Hide' : 'Show'}
        disabled={!bank}
        onClick={() => setShowLeftOut(s => !s)}
      />
      {showLeftOut && bank && <LeftOut key={`${bank.from}-${bank.fetchedAt}`} theme={theme} />}
      {bank?.from === 'device' && (
        <ActionRow
          title="Use the Built-In Bank"
          description={restoreNote || 'The equations the app came with'}
          actionLabel="Use"
          confirmLabel="Use it?"
          disabled={update.running}
          onClick={async () => { await restoreBuiltInFormulaBank(); setRestoreNote(null); }}
        />
      )}
    </>
  );
}
