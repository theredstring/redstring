import { memo, useEffect, useMemo, useState } from 'react';
import { Check, ArrowRight, User } from 'lucide-react';
import useGraphStore from '../../../store/graphStore.js';
import { runCanvasCommand } from '../../../utils/canvas/canvasCommands.js';
import { readMind } from '../../../druid/inApp/readMind.js';
import useDruidStore from './druidStore.js';

/**
 * Inside the Druid: what it keeps in its universe, as views beside its
 * moments (DruidView). Mind: where it is and what that is part of, what it is
 * thinking and holding, the conversation. Goals: what it is after, and its
 * plans. Beliefs: what it believes and how sure it is. Diary: its days.
 *
 * Read from the universe (druid/inApp/readMind.js), so they are there asleep
 * as awake and from one waking to the next. Every Thing and web named is a
 * place to look: clicking it takes the canvas there, and stops following the
 * Druid, so it does not pull you back on its next moment.
 */

const FONT = "'EmOne', sans-serif";
/** How often the views read the universe again while it changes. */
const REFRESH_MS = 800;
const BELIEFS_SHOWN = 120;
const NOTICED_SHOWN = 30;

/** Look at a Thing (in a web it is in) or a web, on the canvas. */
function lookAt({ id = null, web = null }) {
  if (useDruidStore.getState().settings.follow) useDruidStore.getState().setSetting('follow', false);
  const g = useGraphStore.getState();
  if (web && g.graphs.has(web) && g.activeGraphId !== web) {
    if ((g.openGraphIds || []).includes(web) || !g.openGraphTab) g.setActiveGraph(web);
    else g.openGraphTab(web);
  }
  if (id) setTimeout(() => runCanvasCommand('navigateToPrototypeInstances', id), 200);
}

function Name({ t, tokens, strong = false }) {
  if (!t?.name) return null;
  const can = !!(t.web || t.id);
  return (
    <button
      type="button"
      disabled={!can}
      onClick={() => lookAt({ id: t.id && t.web ? t.id : null, web: t.web })}
      title={can ? `Look at ${t.name}` : t.name}
      style={{
        all: 'unset', cursor: can ? 'pointer' : 'default', color: strong ? tokens.brand : tokens.text,
        fontWeight: strong ? 700 : 400, borderBottom: can ? `1px dotted ${tokens.hairlineStrong}` : 'none'
      }}
    >
      {t.name}
    </button>
  );
}

/** A web, to open. */
const Web = ({ w, tokens, strong }) => <Name t={{ name: w.name, web: w.id }} tokens={tokens} strong={strong} />;

function Section({ label, children, tokens, note = null }) {
  return (
    <div style={{ padding: '10px 0', borderTop: `1px solid ${tokens.hairline}` }}>
      <div style={{ fontSize: 10, color: tokens.muted, marginBottom: 6, display: 'flex', justifyContent: 'space-between', gap: 8 }}>
        <span>{label}</span>
        {note && <span>{note}</span>}
      </div>
      {children}
    </div>
  );
}

function Bar({ value, tokens }) {
  return (
    <div style={{ width: 40, height: 4, borderRadius: 2, background: tokens.field, flexShrink: 0, overflow: 'hidden' }}>
      <div style={{ width: `${Math.round(Math.max(0, Math.min(1, value)) * 100)}%`, height: '100%', background: tokens.brand, opacity: 0.7 }} />
    </div>
  );
}

const Empty = ({ children, tokens }) => <div style={{ color: tokens.muted, fontSize: 12, lineHeight: 1.5, padding: '24px 4px', textAlign: 'center' }}>{children}</div>;

const join = (items, render) => items.map((x, i) => <span key={x.id || x.name || i}>{i ? ', ' : ''}{render(x)}</span>);

function MindNow({ m, tokens }) {
  const n = m.now;
  return (
    <>
      <Section label="Where it is" tokens={tokens} note={m.tick ? `moment ${m.tick}` : null}>
        <div style={{ fontSize: 12, lineHeight: 1.6 }}>
          {n.web ? <>In <Web w={n.web} tokens={tokens} strong /></> : 'Nowhere yet'}
          {n.focus && <>, looking at <Name t={n.focus} tokens={tokens} strong /></>}
        </div>
        {n.above.length > 0 && (
          <div style={{ fontSize: 11, lineHeight: 1.6, color: tokens.muted }}>
            part of {join(n.above, w => <Web w={w} tokens={tokens} />)}
          </div>
        )}
      </Section>
      {n.task && (
        <Section label="Working on" tokens={tokens}>
          <div style={{ fontSize: 12, lineHeight: 1.6 }}>
            <Name t={n.task.goal} tokens={tokens} />
            {n.task.at && <> at <Name t={n.task.at} tokens={tokens} /></>}
            <span style={{ color: tokens.muted }}>{` · since moment ${n.task.since}`}</span>
          </div>
        </Section>
      )}
      {n.conversation && (
        <Section label="Talking with you" tokens={tokens}>
          <div style={{ fontSize: 12, lineHeight: 1.6 }}>
            {n.conversation.ask && <div>You asked it to {n.conversation.ask.charAt(0).toLowerCase()}{n.conversation.ask.slice(1)}.</div>}
            {n.conversation.topic.length > 0 && <div>About {join(n.conversation.topic, t => <Name t={t} tokens={tokens} />)}.</div>}
            {n.conversation.promised.length > 0 && <div>It said it would look at {join(n.conversation.promised, t => <Name t={t} tokens={tokens} />)}.</div>}
            {n.conversation.away.length > 0 && <div style={{ color: tokens.muted }}>Leaving alone: {join(n.conversation.away, t => <Name t={t} tokens={tokens} />)}.</div>}
          </div>
        </Section>
      )}
      <Section label="Thinking" tokens={tokens}>
        {n.thoughts.length === 0 && <div style={{ fontSize: 12, color: tokens.muted }}>Nothing yet.</div>}
        {n.thoughts.map((t, i) => (
          <div key={i} style={{ fontSize: i ? 11 : 13, lineHeight: 1.45, color: i ? tokens.muted : tokens.text, marginBottom: 6 }}>{t}</div>
        ))}
        {n.throughLine && <div style={{ fontSize: 11, lineHeight: 1.45, marginTop: 2 }}><span style={{ color: tokens.muted }}>Lately: </span>{n.throughLine}</div>}
      </Section>
      <Section label="Holding in mind" tokens={tokens}>
        {n.held.length === 0 && <div style={{ fontSize: 12, color: tokens.muted }}>Nothing.</div>}
        {n.held.map(h => (
          <div key={h.id} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, lineHeight: 1.7 }}>
            <Bar value={h.a} tokens={tokens} />
            <span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {h.scratch ? <span title="A half-formed thought, held only in mind">{h.name}<span style={{ color: tokens.muted }}> (half-formed)</span></span> : <Name t={h} tokens={tokens} />}
            </span>
          </div>
        ))}
      </Section>
      {n.trail.length > 0 && (
        <Section label="What it did lately" tokens={tokens}>
          {n.trail.map((t, i) => (
            <div key={i} style={{ display: 'flex', gap: 8, fontSize: 11, lineHeight: 1.5 }}>
              <span style={{ color: tokens.muted, flexShrink: 0, width: 40 }}>{t.tick}</span>
              <span style={{ minWidth: 0 }}>{t.web ? <Name t={{ name: t.text, web: t.web }} tokens={tokens} /> : t.text}</span>
            </div>
          ))}
        </Section>
      )}
      {n.noticed.length > 0 && (
        <Section label="Noticed, not yet placed" tokens={tokens} note={String(n.noticed.length)}>
          <div style={{ fontSize: 11, lineHeight: 1.7 }}>
            {join(n.noticed.slice(0, NOTICED_SHOWN), t => <Name t={t} tokens={tokens} />)}
            {n.noticed.length > NOTICED_SHOWN && <span style={{ color: tokens.muted }}>{`, and ${n.noticed.length - NOTICED_SHOWN} more`}</span>}
          </div>
        </Section>
      )}
    </>
  );
}

function Goal({ g, tokens, smaller = false }) {
  return (
    <div style={{ padding: smaller ? '4px 0 0 14px' : '6px 0' }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 6, fontSize: smaller ? 12 : 13, lineHeight: 1.4 }}>
        {g.fromPerson && <User size={11} style={{ flexShrink: 0, color: tokens.brand, position: 'relative', top: 1 }} aria-label="you asked" />}
        <span><Name t={g} tokens={tokens} strong={!smaller} /></span>
      </div>
      <div style={{ fontSize: 10, color: tokens.muted, marginTop: 1, paddingLeft: g.fromPerson ? 17 : 0 }}>
        {[g.fromPerson && 'you asked', g.setOutWith && 'what it set out with', smaller && 'on the way', g.since != null && `since moment ${g.since}`].filter(Boolean).join(' · ')}
      </div>
      {g.plans.map(p => (
        <div key={p.id} style={{ margin: '6px 0 0 14px', paddingLeft: 8, borderLeft: `2px solid ${tokens.hairline}` }}>
          <div style={{ fontSize: 11, color: tokens.muted, marginBottom: 2 }}><Name t={p} tokens={tokens} /></div>
          {p.steps.map(s => (
            <div key={s.id} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, lineHeight: 1.6, color: s.done ? tokens.muted : tokens.text }}>
              {s.done ? <Check size={11} style={{ flexShrink: 0 }} /> : s.next ? <ArrowRight size={11} style={{ flexShrink: 0, color: tokens.brand }} /> : <span style={{ width: 11, flexShrink: 0 }} />}
              <span style={s.done ? { textDecoration: 'line-through' } : null}><Name t={s} tokens={tokens} strong={s.next} /></span>
            </div>
          ))}
        </div>
      ))}
      {(g.smaller || []).map(x => <Goal key={x.id} g={x} tokens={tokens} smaller />)}
    </div>
  );
}

function Goals({ m, tokens }) {
  const STATUS = { reached: 'reached', abandoned: 'given up', dropped: 'let go' };
  return (
    <>
      <Section label="What it is after" tokens={tokens}>
        {m.goals.length === 0 && <div style={{ fontSize: 12, color: tokens.muted }}>No open goals.</div>}
        {m.goals.map(g => <Goal key={g.id} g={g} tokens={tokens} />)}
      </Section>
      {m.closed.length > 0 && (
        <Section label="Lately reached or given up" tokens={tokens}>
          {m.closed.map(g => (
            <div key={g.id} style={{ display: 'flex', justifyContent: 'space-between', gap: 8, fontSize: 12, lineHeight: 1.6 }}>
              <span style={{ minWidth: 0 }}><Name t={g} tokens={tokens} /></span>
              <span style={{ fontSize: 10, color: tokens.muted, flexShrink: 0 }}>{STATUS[g.status] || g.status}{g.at != null ? `, ${g.at}` : ''}</span>
            </div>
          ))}
        </Section>
      )}
    </>
  );
}

function Beliefs({ m, tokens, field }) {
  const [filter, setFilter] = useState('');
  const shown = useMemo(() => {
    const q = filter.trim().toLowerCase();
    const list = q ? m.beliefs.filter(b => b.claim.toLowerCase().includes(q) || (b.about?.name || '').toLowerCase().includes(q)) : m.beliefs;
    return { list: list.slice(0, BELIEFS_SHOWN), total: list.length };
  }, [m.beliefs, filter]);
  if (!m.beliefs.length) return <Empty tokens={tokens}>It believes nothing yet. Beliefs come from saying what it believes about a Thing, and grow surer or weaker with evidence.</Empty>;
  return (
    <>
      <div style={{ padding: '10px 0 4px' }}>
        <input style={field} value={filter} onChange={e => setFilter(e.target.value)} placeholder={`Find among ${m.beliefs.length} beliefs`} />
      </div>
      {shown.list.map(b => (
        <div key={b.id} style={{ padding: '8px 0', borderTop: `1px solid ${tokens.hairline}` }}>
          <div style={{ fontSize: 12, lineHeight: 1.45 }}>{b.claim}</div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 10, color: tokens.muted, marginTop: 3 }}>
            <Bar value={b.c} tokens={tokens} />
            <span style={{ minWidth: 0 }}>
              {b.words}{b.about && <> · about <Name t={b.about} tokens={tokens} /></>} · {b.evidence} piece{b.evidence === 1 ? '' : 's'} of evidence
            </span>
          </div>
        </div>
      ))}
      {shown.total > shown.list.length && <div style={{ fontSize: 10, color: tokens.muted, textAlign: 'center', padding: '8px 0' }}>{shown.total - shown.list.length} more; find to narrow them</div>}
    </>
  );
}

function Day({ d, tokens, open, onToggle }) {
  const date = new Date(`${d.date}T12:00:00`);
  const label = Number.isNaN(date.getTime()) ? d.date : date.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' });
  return (
    <Section label={label} tokens={tokens} note={`${d.count} moment${d.count === 1 ? '' : 's'}`}>
      {d.about.length > 0 && (
        <div style={{ fontSize: 12, lineHeight: 1.6 }}>
          <span style={{ color: tokens.muted }}>Mostly about </span>
          {join(d.about, a => <><Name t={a} tokens={tokens} /><span style={{ color: tokens.muted, fontSize: 10 }}>{` ${a.n}`}</span></>)}
        </div>
      )}
      {d.moments.length > 0 && (
        <button type="button" onClick={onToggle} style={{ all: 'unset', cursor: 'pointer', fontSize: 10, color: tokens.brand, marginTop: 6 }}>
          {open ? 'Hide' : 'Show'} the {d.moments.length} latest moment{d.moments.length === 1 ? '' : 's'}
        </button>
      )}
      {open && d.moments.map(e => (
        <div key={e.id} style={{ display: 'flex', gap: 8, fontSize: 11, lineHeight: 1.5, marginTop: 4 }}>
          <span style={{ color: tokens.muted, flexShrink: 0, width: 40 }}>{e.tick}</span>
          <span style={{ minWidth: 0 }}>{e.text}</span>
        </div>
      ))}
    </Section>
  );
}

function Diary({ m, tokens }) {
  const [open, setOpen] = useState(() => new Set(m.days[0] ? [m.days[0].date] : []));
  if (!m.days.length) return <Empty tokens={tokens}>No days yet. Each moment it writes something is kept here; when it sleeps, older moments are folded into what the day was about.</Empty>;
  const toggle = (date) => setOpen(s => { const n = new Set(s); if (n.has(date)) n.delete(date); else n.add(date); return n; });
  return m.days.map(d => <Day key={d.date} d={d} tokens={tokens} open={open.has(d.date)} onToggle={() => toggle(d.date)} />);
}

/**
 * @param {Object} props
 * @param {'mind'|'goals'|'beliefs'|'diary'} props.view
 * @param {Object} props.tokens
 * @param {Object} props.field   the panel's input style
 */
function DruidMind({ view, tokens, field }) {
  const [m, setM] = useState(() => readMind(useGraphStore));
  useEffect(() => {
    let timer = null;
    const read = () => { timer = null; try { setM(readMind(useGraphStore)); } catch { /* a universe mid-load */ } };
    read();
    const unsub = useGraphStore.subscribe(() => { if (!timer) timer = setTimeout(read, REFRESH_MS); });
    return () => { unsub(); if (timer) clearTimeout(timer); };
  }, []);
  const t = { ...tokens, hairlineStrong: tokens.hairlineStrong || tokens.muted };
  if (!m) return <Empty tokens={t}>No Druid has lived in this universe yet. Wake it, and what it keeps in mind shows here.</Empty>;
  return (
    <div style={{ fontFamily: FONT, color: t.text, paddingBottom: 12 }}>
      {view === 'mind' && <MindNow m={m} tokens={t} />}
      {view === 'goals' && <Goals m={m} tokens={t} />}
      {view === 'beliefs' && <Beliefs m={m} tokens={t} field={field} />}
      {view === 'diary' && <Diary m={m} tokens={t} />}
    </div>
  );
}

export default memo(DruidMind);
