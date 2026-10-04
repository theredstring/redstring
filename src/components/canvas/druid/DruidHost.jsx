import { memo, useEffect, useState } from 'react';
import debugConfig from '../../../utils/debugConfig.js';
import { useTheme } from '../../../hooks/useTheme.js';
import PanelIconButton from '../../shared/PanelIconButton.jsx';
import useDruidStore from './druidStore.js';

/**
 * The Druid panel: start a small local model living in the open universe, and
 * watch it think — each moment's choice, what it did, and its one sentence of
 * thought. While it lives, the canvas goes where it looks (Follow).
 *
 * Shown when Settings › Debug › The Druid is on.
 */

const FONT = "'EmOne', sans-serif";

const SPEAK = [
  { value: 'commands', label: 'writes commands' },
  { value: 'menu', label: 'picks from a menu' }
];

const MINDS = [
  { value: 'afm', label: "Apple's model" },
  { value: 'openai', label: 'LM Studio' }
];

function Moment({ c, tokens }) {
  const where = [c.locus?.webName, c.locus?.focusName].filter(Boolean).join(' › ');
  return (
    <div style={{ padding: '8px 0', borderTop: `1px solid ${tokens.hairline}` }}>
      <div style={{ fontSize: 10, color: tokens.muted, display: 'flex', justifyContent: 'space-between', gap: 8 }}>
        <span>{c.tick}</span>
        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{where || '—'}</span>
      </div>
      {c.thought && (
        <div style={{ fontSize: 13, lineHeight: 1.4, color: tokens.text, margin: '4px 0' }}>{c.thought}</div>
      )}
      <div style={{ fontSize: 11, color: c.result?.ok ? tokens.brand : tokens.muted }}>
        {c.chose || 'did not choose'}{c.text ? ` → ${c.text}` : ''}
      </div>
      <div style={{ fontSize: 10, color: tokens.muted }}>
        {c.result?.summary}
        {c.slept ? ' · slept' : ''}
      </div>
    </div>
  );
}

function DruidPanel() {
  const theme = useTheme();
  const tokens = {
    text: theme.canvas.textPrimary,
    muted: theme.canvas.textSecondary,
    brand: theme.canvas.brandText,
    bg: theme.canvas.bg,
    border: theme.canvas.border,
    hairline: theme.darkMode ? 'rgba(255,255,255,0.10)' : 'rgba(38,0,0,0.10)',
    field: theme.darkMode ? 'rgba(255,255,255,0.06)' : 'rgba(38,0,0,0.05)'
  };
  const status = useDruidStore(s => s.status);
  const error = useDruidStore(s => s.error);
  const cycles = useDruidStore(s => s.cycles);
  const stats = useDruidStore(s => s.stats);
  const settings = useDruidStore(s => s.settings);
  const { setSetting, start, stop } = useDruidStore.getState();
  const [collapsed, setCollapsed] = useState(false);

  const idle = status === 'idle';
  const latest = cycles[0];
  const field = {
    width: '100%', boxSizing: 'border-box', fontFamily: FONT, fontSize: 12, color: tokens.text,
    background: tokens.field, border: `1px solid ${tokens.hairline}`, borderRadius: 6, padding: '5px 8px'
  };

  return (
    <div
      style={{
        position: 'fixed', left: 16, bottom: 76, zIndex: 900, width: 340, maxWidth: 'calc(100vw - 32px)',
        maxHeight: collapsed ? undefined : '60vh', display: 'flex', flexDirection: 'column',
        background: tokens.bg, color: tokens.text, border: `1px solid ${tokens.border}`, borderRadius: 10,
        boxShadow: '0 4px 18px rgba(0,0,0,0.25)', fontFamily: FONT
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 12px' }}>
        <button
          onClick={() => setCollapsed(v => !v)}
          style={{ all: 'unset', cursor: 'pointer', fontWeight: 'bold', fontSize: 14, color: tokens.brand, flex: 1 }}
        >
          The Druid
          <span style={{ fontWeight: 'normal', fontSize: 11, color: tokens.muted, marginLeft: 8 }}>
            {status === 'living' ? `living · moment ${latest?.tick ?? '…'}` : status === 'idle' ? 'asleep' : `${status}…`}
          </span>
        </button>
        {idle
          ? <PanelIconButton label="Wake" labelFontSize={11} variant="outline" onClick={start} style={{ padding: '4px 12px' }} />
          : <PanelIconButton label="Stop" labelFontSize={11} variant="outline" onClick={stop} disabled={status === 'stopping'} style={{ padding: '4px 12px' }} />}
      </div>

      {!collapsed && (
        <div style={{ padding: '0 12px 10px', overflowY: 'auto', minHeight: 0 }}>
          {idle && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 8 }}>
              <div style={{ display: 'flex', gap: 6 }}>
                {MINDS.map(m => (
                  <PanelIconButton
                    key={m.value}
                    label={m.label}
                    labelFontSize={11}
                    variant="outline"
                    active={settings.mind === m.value}
                    onClick={() => setSetting('mind', m.value)}
                    style={{ padding: '4px 10px' }}
                  />
                ))}
              </div>
              <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                <span style={{ fontSize: 10, color: tokens.muted }}>It</span>
                {SPEAK.map(m => (
                  <PanelIconButton
                    key={m.value}
                    label={m.label}
                    labelFontSize={11}
                    variant="outline"
                    active={(settings.speak || 'commands') === m.value}
                    onClick={() => setSetting('speak', m.value)}
                    style={{ padding: '4px 10px' }}
                  />
                ))}
              </div>
              {settings.mind === 'openai' && (
                <input style={field} value={settings.model} placeholder="model" onChange={e => setSetting('model', e.target.value)} />
              )}
              <input
                style={field}
                value={settings.seed}
                placeholder="On its mind when it first wakes (optional)"
                onChange={e => setSetting('seed', e.target.value)}
              />
              <div style={{ fontSize: 10, color: tokens.muted, lineHeight: 1.4 }}>
                It lives in the universe that is open and writes into it. It picks up where it left off.
              </div>
            </div>
          )}

          <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, color: tokens.muted, marginBottom: 6 }}>
            <input type="checkbox" checked={!!settings.follow} onChange={e => setSetting('follow', e.target.checked)} />
            Follow where it looks
          </label>

          {error && <div style={{ fontSize: 11, color: theme.alert.error.text, margin: '4px 0 8px' }}>{error}</div>}

          {latest?.held?.length > 0 && (
            <div style={{ fontSize: 10, color: tokens.muted, marginBottom: 4 }}>
              Holding in mind: {latest.held.join(', ')}
            </div>
          )}

          {cycles.map(c => <Moment key={c.tick} c={c} tokens={tokens} />)}

          {stats && (
            <div style={{ fontSize: 10, color: tokens.muted, paddingTop: 6, borderTop: `1px solid ${tokens.hairline}` }}>
              {stats.calls} calls · {stats.invalid} unusable · {Math.round(stats.ms / Math.max(1, stats.calls))} ms each
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function DruidHost() {
  const [enabled, setEnabled] = useState(() => debugConfig.isDruidEnabled());
  useEffect(() => {
    const unsubscribe = debugConfig.addListener((config) => setEnabled(!!config.showDruid));
    setEnabled(debugConfig.isDruidEnabled());
    return unsubscribe;
  }, []);
  // Turning the panel off while it lives also puts it to sleep.
  useEffect(() => { if (!enabled) useDruidStore.getState().stop(); }, [enabled]);
  return enabled ? <DruidPanel /> : null;
}

export default memo(DruidHost);
