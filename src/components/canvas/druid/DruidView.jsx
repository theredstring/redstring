import { memo, useEffect, useRef, useState } from 'react';
import { Send, Copy, Check, Eraser } from 'lucide-react';
import { useTheme } from '../../../hooks/useTheme.js';
import PanelIconButton from '../../shared/PanelIconButton.jsx';
import useDruidStore from './druidStore.js';

/**
 * The Druid, inside the Wizard panel (its "The Druid" mode): wake a small
 * local model in the open universe and watch it think. Each moment shows its
 * thought and what it did. You can talk to it; what you say reaches it on its
 * next moment and steers it, and it answers in a sentence.
 */

const FONT = "'EmOne', sans-serif";
/** Entries drawn; the store keeps the whole run for Copy. */
const SHOWN = 150;

const MINDS = [
  { value: 'afm', label: "Apple's model" },
  { value: 'openai', label: 'LM Studio' }
];

const SPEAK = [
  { value: 'menu', label: 'picks from a menu' },
  { value: 'commands', label: 'writes commands' }
];

function Moment({ c, tokens }) {
  const where = [c.locus?.webName, c.locus?.focusName].filter(Boolean).join(' › ');
  return (
    <div style={{ padding: '8px 0', borderTop: `1px solid ${tokens.hairline}` }}>
      <div style={{ fontSize: 10, color: tokens.muted, display: 'flex', justifyContent: 'space-between', gap: 8 }}>
        <span>{c.tick}</span>
        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{where || '—'}</span>
      </div>
      {c.thought && <div style={{ fontSize: 13, lineHeight: 1.4, color: tokens.text, margin: '4px 0' }}>{c.thought}</div>}
      <div style={{ fontSize: 11, color: c.result?.ok ? tokens.brand : tokens.muted }}>
        {c.chose || 'did not choose'}{c.text ? ` → ${c.text}` : ''}
      </div>
      <div style={{ fontSize: 10, color: tokens.muted }}>
        {c.result?.summary}{c.slept ? ' · slept' : ''}
      </div>
    </div>
  );
}

function Said({ e, tokens }) {
  const mine = e.kind === 'you';
  return (
    <div style={{ display: 'flex', justifyContent: mine ? 'flex-end' : 'flex-start', padding: '6px 0' }}>
      <div style={{
        maxWidth: '85%', fontSize: 13, lineHeight: 1.4, padding: '6px 10px', borderRadius: 10,
        color: tokens.text, background: mine ? tokens.field : 'transparent', border: mine ? 'none' : `1px solid ${tokens.hairline}`
      }}>
        {!mine && <div style={{ fontSize: 10, color: tokens.brand, marginBottom: 2 }}>The Druid</div>}
        {e.text}
        {mine && e.pending && <div style={{ fontSize: 10, color: tokens.muted, marginTop: 2 }}>it will hear this when it wakes</div>}
      </div>
    </div>
  );
}

/**
 * The Druid's buttons in the panel header, in place of the Wizard's (new
 * conversation, API key, bridge): copy everything shown, and clear it.
 */
export function DruidHeaderActions() {
  const empty = useDruidStore(s => s.stream.length === 0 && !s.throughLine);
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return undefined;
    const t = setTimeout(() => setCopied(false), 1200);
    return () => clearTimeout(t);
  }, [copied]);
  const copy = async () => {
    const text = await useDruidStore.getState().transcript();
    navigator.clipboard?.writeText(text).then(() => setCopied(true), () => {});
  };
  return (
    <div className="ai-header-actions">
      <PanelIconButton icon={copied ? Check : Copy} size={18} onClick={copy} disabled={empty} title={copied ? 'Copied' : 'Copy the whole run, and the universe as it stands'} />
      <PanelIconButton icon={Eraser} size={18} onClick={() => useDruidStore.getState().clear()} disabled={empty} title="Clear what is shown (the universe keeps everything)" />
    </div>
  );
}

function DruidView({ active = true }) {
  const theme = useTheme();
  const tokens = {
    text: theme.canvas.textPrimary,
    muted: theme.canvas.textSecondary,
    brand: theme.canvas.brandText,
    hairline: theme.darkMode ? 'rgba(255,255,255,0.10)' : 'rgba(38,0,0,0.10)',
    field: theme.darkMode ? 'rgba(255,255,255,0.06)' : 'rgba(38,0,0,0.05)'
  };
  const status = useDruidStore(s => s.status);
  const error = useDruidStore(s => s.error);
  const stream = useDruidStore(s => s.stream);
  const stats = useDruidStore(s => s.stats);
  const held = useDruidStore(s => s.held);
  const throughLine = useDruidStore(s => s.throughLine);
  const settings = useDruidStore(s => s.settings);
  const { setSetting, start, stop, say } = useDruidStore.getState();
  const [draft, setDraft] = useState('');
  const bottomRef = useRef(null);

  const idle = status === 'idle';
  useEffect(() => { if (active) bottomRef.current?.scrollIntoView({ block: 'end' }); }, [stream.length, active]);

  const lastTick = [...stream].reverse().find(e => e.kind === 'moment')?.tick;
  const field = {
    width: '100%', boxSizing: 'border-box', fontFamily: FONT, fontSize: 12, color: tokens.text,
    background: tokens.field, border: `1px solid ${tokens.hairline}`, borderRadius: 6, padding: '5px 8px'
  };
  const send = () => {
    const text = draft.trim();
    if (!text) return;
    say(text);
    setDraft('');
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0, fontFamily: FONT, color: tokens.text }}>
      <div style={{ padding: '8px 12px', borderBottom: `1px solid ${tokens.hairline}`, display: 'flex', flexDirection: 'column', gap: 6 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ flex: 1, fontSize: 11, color: tokens.muted }}>
            {status === 'living' ? `living · moment ${lastTick ?? '…'}` : status === 'idle' ? 'asleep' : `${status}…`}
            {stats ? ` · ${stats.calls} calls, ${Math.round(stats.ms / Math.max(1, stats.calls))} ms each` : ''}
          </span>
          {idle
            ? <PanelIconButton label="Wake" labelFontSize={11} variant="outline" onClick={start} style={{ padding: '4px 12px' }} />
            : <PanelIconButton label="Sleep" labelFontSize={11} variant="outline" onClick={stop} disabled={status === 'stopping'} style={{ padding: '4px 12px' }} />}
        </div>
        {idle && (
          <>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              {MINDS.map(m => (
                <PanelIconButton key={m.value} label={m.label} labelFontSize={11} variant="outline" active={settings.mind === m.value} onClick={() => setSetting('mind', m.value)} style={{ padding: '4px 10px' }} />
              ))}
              {SPEAK.map(m => (
                <PanelIconButton key={m.value} label={m.label} labelFontSize={11} variant="outline" active={(settings.speak || 'menu') === m.value} onClick={() => setSetting('speak', m.value)} style={{ padding: '4px 10px' }} />
              ))}
            </div>
            {settings.mind === 'openai' && <input style={field} value={settings.model} placeholder="model" onChange={e => setSetting('model', e.target.value)} />}
            <div style={{ fontSize: 10, color: tokens.muted, lineHeight: 1.4 }}>
              It lives in the universe that is open and writes into it, so give it one of its own. It picks up where it left off.
            </div>
          </>
        )}
        <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, color: tokens.muted }}>
          <input type="checkbox" checked={!!settings.follow} onChange={e => setSetting('follow', e.target.checked)} />
          Follow where it looks
        </label>
        {throughLine && <div style={{ fontSize: 11, color: tokens.text, lineHeight: 1.4 }}><span style={{ color: tokens.muted }}>Lately: </span>{throughLine}</div>}
        {held?.length > 0 && <div style={{ fontSize: 10, color: tokens.muted }}>Holding in mind: {held.join(', ')}</div>}
        {error && <div style={{ fontSize: 11, color: theme.alert.error.text }}>{error}</div>}
      </div>

      <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: '0 12px' }}>
        {stream.length === 0 && (
          <div style={{ color: tokens.muted, fontSize: 13, textAlign: 'center', padding: '40px 8px', lineHeight: 1.5 }}>
            Wake it to watch it think. Say something to give it something to think about, now or while it lives.
          </div>
        )}
        {stream.length > SHOWN && <div style={{ fontSize: 10, color: tokens.muted, textAlign: 'center', padding: '8px 0' }}>{stream.length - SHOWN} earlier, in Copy</div>}
        {stream.slice(-SHOWN).map((e, i) => (e.kind === 'moment' ? <Moment key={`m${e.tick}-${i}`} c={e} tokens={tokens} /> : <Said key={`s${i}`} e={e} tokens={tokens} />))}
        <div ref={bottomRef} />
      </div>

      <div className="ai-input-container">
        <textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } }}
          placeholder={status === 'living' ? 'Say something to it…' : 'Something for it to think about when it wakes…'}
          className="ai-input"
          rows={1}
        />
        <button onClick={send} disabled={!draft.trim()} className="ai-send-button" title="Say it"><Send /></button>
      </div>
    </div>
  );
}

export default memo(DruidView);
