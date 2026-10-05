import { memo, useEffect, useRef, useState } from 'react';
import { Send, Copy, Check, Eraser, Moon, ArrowDown } from 'lucide-react';
import { useTheme } from '../../../hooks/useTheme.js';
import PanelIconButton from '../../shared/PanelIconButton.jsx';
import useDruidStore, { sleptLine, watchUniverse } from './druidStore.js';

/**
 * The Druid, inside the Wizard panel (its "The Druid" mode): wake a small
 * local model in the open universe and watch it think. Each moment shows its
 * thought and what it did. You can talk to it; what you say reaches it on its
 * next moment and steers it, and it answers in a sentence.
 *
 * What it shows is the open universe's run, kept on this device until it is
 * cleared (druidStore.js, druidRecord.js).
 */

const FONT = "'EmOne', sans-serif";
/** Entries drawn; the store keeps the whole run for Copy. */
const SHOWN = 150;
/** Within this of the bottom, the view follows new moments; further up, you are reading. */
const AT_BOTTOM_PX = 48;

const MINDS = [
  { value: 'afm', label: 'Apple', title: "Apple's on-device model (the desktop app)" },
  { value: 'openai', label: 'LM Studio', title: 'A model loaded in LM Studio on this computer' }
];

const SPEAK = [
  { value: 'menu', label: 'Menu', title: 'It picks from moves offered (and can write one of its own)' },
  { value: 'commands', label: 'Commands', title: 'It writes a plain command every time' }
];

const PACE = [
  { value: 'quick', label: 'Quick', title: 'Each moment follows the last at once' },
  { value: 'steady', label: 'Steady', title: 'A breath between moments, to read along' }
];

const clamp = (lines) => ({ display: '-webkit-box', WebkitLineClamp: lines, WebkitBoxOrient: 'vertical', overflow: 'hidden' });

/** What it chose, read as a sentence: the blank in a move filled with what it wrote. */
function choseLine(c) {
  if (!c.chose) return 'did not choose';
  if (c.chose.includes('___')) return c.text ? c.chose.replace(/:?\s*_{3,}/, `: “${c.text}”`) : c.chose.replace(/\s*_{3,}/, '…');
  return c.text ? `${c.chose} → ${c.text}` : c.chose;
}

const timeOf = (at) => {
  const d = new Date(at);
  const today = new Date().toDateString() === d.toDateString();
  return today
    ? d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
    : d.toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
};

/** Two or three choices side by side, one of them chosen. */
function Choice({ label, options, value, onChange, tokens }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      <span style={{ width: 44, flexShrink: 0, fontSize: 10, color: tokens.muted }}>{label}</span>
      <div style={{ display: 'flex', flex: 1, minWidth: 0, border: `1px solid ${tokens.hairline}`, borderRadius: 6, overflow: 'hidden' }}>
        {options.map((o, i) => {
          const on = value === o.value;
          return (
            <button
              key={o.value}
              type="button"
              title={o.title}
              onClick={() => onChange(o.value)}
              style={{
                flex: 1, minWidth: 0, padding: '4px 6px', fontFamily: FONT, fontSize: 11, cursor: 'pointer',
                whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                border: 'none', borderLeft: i ? `1px solid ${tokens.hairline}` : 'none',
                background: on ? tokens.field : 'transparent', color: on ? tokens.brand : tokens.muted, fontWeight: on ? 700 : 400
              }}
            >
              {o.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function Moment({ c, tokens }) {
  const where = [c.locus?.webName, c.locus?.focusName].filter(Boolean).join(' › ');
  const failed = c.result?.ok === false;
  return (
    <div style={{ padding: '8px 0', borderTop: `1px solid ${tokens.hairline}` }}>
      <div style={{ fontSize: 10, color: tokens.muted, display: 'flex', justifyContent: 'space-between', gap: 8 }}>
        <span style={{ flexShrink: 0 }}>{c.tick}</span>
        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={where}>{where || '—'}</span>
      </div>
      {c.thought && <div style={{ fontSize: 13, lineHeight: 1.4, color: tokens.text, margin: '4px 0' }}>{c.thought}</div>}
      <div style={{ fontSize: 11, lineHeight: 1.4, color: c.result?.ok ? tokens.brand : tokens.muted }}>
        {choseLine(c)}
      </div>
      {c.result?.summary && (
        <div style={{ fontSize: 10, lineHeight: 1.4, color: tokens.muted, marginTop: 1 }}>
          {failed ? `Did not work: ${c.result.summary}` : c.result.summary}
        </div>
      )}
      {/* Every 12 moments it sleeps: merges, repairs, lets go (druid/sleep.js). Its own row, so it is seen. */}
      {c.slept && (
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 6, marginTop: 6, padding: '5px 8px', borderRadius: 6, background: tokens.field, fontSize: 11, lineHeight: 1.4, color: tokens.text }}>
          <Moon size={12} style={{ flexShrink: 0, marginTop: 2, color: tokens.brand }} />
          <span><span style={{ color: tokens.brand }}>Slept</span>: {sleptLine(c.slept)}</span>
        </div>
      )}
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
        {mine && e.pending && <div style={{ fontSize: 10, color: tokens.muted, marginTop: 2 }}>{e.answered ? 'it keeps this in mind when it wakes' : 'it will hear this when it wakes'}</div>}
      </div>
    </div>
  );
}

/** It is working out what to say. */
function Answering({ tokens }) {
  return (
    <div style={{ display: 'flex', padding: '6px 0' }}>
      <div style={{ fontSize: 12, padding: '6px 10px', borderRadius: 10, border: `1px solid ${tokens.hairline}`, color: tokens.muted }}>
        <span style={{ fontSize: 10, color: tokens.brand, marginRight: 6 }}>The Druid</span>is thinking about what to say…
      </div>
    </div>
  );
}

/** Where a waking begins, so a run kept over days reads as its sittings. */
function Woke({ e, tokens }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 0 4px', fontSize: 10, color: tokens.muted }}>
      <div style={{ flex: 1, height: 1, background: tokens.hairline }} />
      <span>Woke{e.at ? `, ${timeOf(e.at)}` : ''}</span>
      <div style={{ flex: 1, height: 1, background: tokens.hairline }} />
    </div>
  );
}

/**
 * The Druid's buttons in the panel header, in place of the Wizard's (new
 * conversation, API key, bridge): copy the run, and clear it. Clearing asks
 * once more, since the run is kept until then.
 */
export function DruidHeaderActions() {
  const empty = useDruidStore(s => s.stream.length === 0 && !s.throughLine);
  const living = useDruidStore(s => s.status !== 'idle');
  const [copied, setCopied] = useState(false);
  const [confirming, setConfirming] = useState(false);
  useEffect(() => {
    if (!copied) return undefined;
    const t = setTimeout(() => setCopied(false), 1200);
    return () => clearTimeout(t);
  }, [copied]);
  useEffect(() => {
    if (!confirming) return undefined;
    const t = setTimeout(() => setConfirming(false), 3000);
    return () => clearTimeout(t);
  }, [confirming]);
  const copy = async () => {
    const text = await useDruidStore.getState().transcript();
    navigator.clipboard?.writeText(text).then(() => setCopied(true), () => {});
  };
  const clear = () => {
    if (!confirming) { setConfirming(true); return; }
    setConfirming(false);
    useDruidStore.getState().clear();
  };
  return (
    <div className="ai-header-actions">
      <PanelIconButton icon={copied ? Check : Copy} size={18} onClick={copy} disabled={empty} title={copied ? 'Copied' : 'Copy the whole run, and the universe as it stands'} />
      <PanelIconButton
        icon={Eraser}
        size={18}
        label={confirming ? 'Clear the run?' : undefined}
        labelFontSize={11}
        variant={confirming ? 'outline' : 'ghost'}
        onClick={clear}
        disabled={empty || living}
        title={living ? 'Put it to sleep to clear its run' : confirming ? 'Click again to clear' : "Clear this universe's run from the panel (the universe keeps everything it made)"}
      />
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
  const behind = useDruidStore(s => s.behind);
  const answering = useDruidStore(s => s.answering);
  const { setSetting, start, stop, say } = useDruidStore.getState();
  const [draft, setDraft] = useState('');
  const scrollRef = useRef(null);
  const bottomRef = useRef(null);
  // Following the newest moment, unless you have scrolled up to read.
  const [following, setFollowing] = useState(true);

  // The open universe's run, now and whenever another is opened.
  useEffect(() => { watchUniverse().catch(() => {}); }, []);

  const idle = status === 'idle';
  const living = status === 'living';
  useEffect(() => {
    if (active && following) bottomRef.current?.scrollIntoView({ block: 'end' });
  }, [stream.length, answering, active, following]);
  const onScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < AT_BOTTOM_PX;
    if (atBottom !== following) setFollowing(atBottom);
  };

  const lastTick = [...stream].reverse().find(e => e.kind === 'moment')?.tick;
  // Seconds a moment, over the last few of this waking.
  const recent = [];
  for (let i = stream.length - 1; i >= 0 && recent.length < 8 && stream[i].kind !== 'woke'; i--) if (stream[i].kind === 'moment' && stream[i].ms) recent.push(stream[i].ms);
  const perMoment = recent.length ? recent.reduce((a, b) => a + b, 0) / recent.length / 1000 : null;
  const field = {
    width: '100%', boxSizing: 'border-box', fontFamily: FONT, fontSize: 12, color: tokens.text,
    background: tokens.field, border: `1px solid ${tokens.hairline}`, borderRadius: 6, padding: '5px 8px'
  };
  const send = () => {
    const text = draft.trim();
    if (!text) return;
    say(text);
    setDraft('');
    setFollowing(true);
  };
  const stateWord = living ? 'Awake' : idle ? 'Asleep' : status === 'starting' ? 'Waking' : 'Falling asleep';

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0, fontFamily: FONT, color: tokens.text }}>
      <div style={{ padding: '8px 12px 10px', borderBottom: `1px solid ${tokens.hairline}`, display: 'flex', flexDirection: 'column', gap: 8 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 12, color: tokens.text }}>
              {stateWord}{idle || living ? '' : '…'}
              {lastTick != null && <span style={{ color: tokens.muted }}>{` · moment ${lastTick}`}</span>}
            </div>
            {living && stats?.calls > 0 && (
              <div style={{ fontSize: 10, color: tokens.muted }}>{`${perMoment ? `${perMoment.toFixed(1)} s a moment · ` : ''}${stats.calls} calls, ${Math.round(stats.ms / Math.max(1, stats.calls))} ms each`}</div>
            )}
          </div>
          {idle
            ? <PanelIconButton label="Wake" labelFontSize={11} variant="outline" onClick={start} style={{ padding: '4px 12px' }} />
            : <PanelIconButton label="Sleep" labelFontSize={11} variant="outline" onClick={stop} disabled={status !== 'living'} style={{ padding: '4px 12px' }} />}
        </div>
        {idle && (
          <>
            <Choice label="Mind" options={MINDS} value={settings.mind} onChange={v => setSetting('mind', v)} tokens={tokens} />
            {settings.mind === 'openai' && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ width: 44, flexShrink: 0, fontSize: 10, color: tokens.muted }}>Model</span>
                <input style={field} value={settings.model} placeholder="the model loaded in LM Studio" onChange={e => setSetting('model', e.target.value)} />
              </div>
            )}
            <Choice label="Moves" options={SPEAK} value={settings.speak || 'menu'} onChange={v => setSetting('speak', v)} tokens={tokens} />
            <Choice label="Pace" options={PACE} value={settings.pace || 'quick'} onChange={v => setSetting('pace', v)} tokens={tokens} />
          </>
        )}
        <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, color: tokens.muted, cursor: 'pointer' }}>
          <input type="checkbox" checked={!!settings.follow} onChange={e => setSetting('follow', e.target.checked)} style={{ margin: 0 }} />
          Follow where it looks
        </label>
        {throughLine && (
          <div style={{ fontSize: 11, color: tokens.text, lineHeight: 1.4, ...clamp(3) }} title={throughLine}>
            <span style={{ color: tokens.muted }}>Lately: </span>{throughLine}
          </div>
        )}
        {held?.length > 0 && (
          <div style={{ fontSize: 10, color: tokens.muted, lineHeight: 1.4, ...clamp(2) }} title={held.join('\n')}>
            Holding in mind: {held.join(' · ')}
          </div>
        )}
        {error && <div style={{ fontSize: 11, lineHeight: 1.4, color: theme.alert.error.text }}>{error}</div>}
        {behind && living && (
          <div style={{ fontSize: 11, lineHeight: 1.4, color: tokens.muted }}>
            Its code has changed since it woke. Put it to sleep and wake it to use the new code.
          </div>
        )}
      </div>

      <div style={{ position: 'relative', flex: 1, minHeight: 0, display: 'flex' }}>
        <div ref={scrollRef} onScroll={onScroll} style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: '0 12px' }}>
          {stream.length === 0 && (
            <div style={{ color: tokens.muted, fontSize: 13, textAlign: 'center', padding: '40px 8px', lineHeight: 1.5 }}>
              Wake it to watch it think. Talk to it any time, awake or asleep: it answers from what its universe holds, and what you say steers it.
              <div style={{ fontSize: 11, marginTop: 12 }}>
                It lives in the universe that is open and writes into it, so give it one of its own. What it does there is kept here until you clear it.
              </div>
            </div>
          )}
          {stream.length > SHOWN && <div style={{ fontSize: 10, color: tokens.muted, textAlign: 'center', padding: '8px 0' }}>{stream.length - SHOWN} earlier, in Copy</div>}
          {/* Keyed by each entry's place in its universe's run (seq), so a new
              moment never remounts the ones before it. */}
          {stream.slice(-SHOWN).map((e, i) => {
            const key = e.seq ?? `at${Math.max(0, stream.length - SHOWN) + i}`;
            if (e.kind === 'moment') return <Moment key={key} c={e} tokens={tokens} />;
            if (e.kind === 'woke') return <Woke key={key} e={e} tokens={tokens} />;
            return <Said key={key} e={e} tokens={tokens} />;
          })}
          {answering && <Answering tokens={tokens} />}
          <div ref={bottomRef} />
        </div>
        {!following && stream.length > 0 && (
          <button
            type="button"
            onClick={() => { setFollowing(true); bottomRef.current?.scrollIntoView({ block: 'end', behavior: 'smooth' }); }}
            style={{
              position: 'absolute', bottom: 10, left: '50%', transform: 'translateX(-50%)', display: 'flex', alignItems: 'center', gap: 4,
              padding: '4px 10px', borderRadius: 12, border: `1px solid ${tokens.hairline}`, cursor: 'pointer',
              background: theme.canvas.bg, color: tokens.text, fontFamily: FONT, fontSize: 11,
              boxShadow: '0 1px 4px rgba(0,0,0,0.15)'
            }}
          >
            <ArrowDown size={12} /> Latest
          </button>
        )}
      </div>

      <div className="ai-input-container">
        <textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } }}
          placeholder="Talk to it…"
          className="ai-input"
          rows={1}
        />
        <button onClick={send} disabled={!draft.trim()} className="ai-send-button" title="Say it"><Send /></button>
      </div>
    </div>
  );
}

export default memo(DruidView);
