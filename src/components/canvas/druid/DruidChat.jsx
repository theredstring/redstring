import { memo, useState } from 'react';
import { Clover, User, ChevronRight, ChevronDown, Moon } from 'lucide-react';

/**
 * Talking with the Druid, as a conversation (DruidView's Chat tab): what you
 * say and what it says, in the Wizard's bubbles (AICollaborationPanel.css),
 * with a clover for it as the Wizard has its hat.
 *
 * The internals are folded away, not hidden: between two things said, the
 * moments it lived are one quiet line (how many, what it changed, the latest
 * of it), opened on a click; and while it is awake, the row at the bottom
 * says what it is thinking now. The Moments tab has the rest.
 */

const FONT = "'EmOne', sans-serif";
/** Things said, at most, drawn; the store keeps the whole run. */
const SAID_SHOWN = 120;

const timeOf = (at) => (at ? new Date(at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) : null);

/** The stream as a conversation: things said, and the moments between them folded into one line each. */
function asConversation(stream) {
  const out = [];
  let between = null;
  for (const e of stream) {
    if (e.kind === 'moment') {
      if (!between) { between = { kind: 'between', moments: [], key: `b${e.seq ?? out.length}` }; out.push(between); }
      between.moments.push(e);
      continue;
    }
    if (e.kind === 'you' || e.kind === 'reply') { between = null; out.push(e); }
  }
  // From the first thing said: the moments before it are not part of the conversation.
  const first = out.findIndex(x => x.kind !== 'between');
  const talk = first < 0 ? [] : out.slice(first);
  const said = talk.filter(x => x.kind !== 'between');
  if (said.length <= SAID_SHOWN) return talk;
  const from = talk.indexOf(said[said.length - SAID_SHOWN]);
  return talk.slice(from);
}

/** One line for the moments between two things said, and their summaries when opened. */
function Between({ b, tokens }) {
  const [open, setOpen] = useState(false);
  const done = b.moments.filter(m => m.result?.ok);
  const changes = done.filter(m => m.result?.wrote);
  const slept = b.moments.filter(m => m.slept).length;
  const latest = (changes.at(-1) || done.at(-1))?.result?.summary;
  const n = b.moments.length;
  const Chevron = open ? ChevronDown : ChevronRight;
  return (
    <div style={{ alignSelf: 'stretch', paddingLeft: 52, fontFamily: FONT }}>
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        title={open ? 'Fold these moments away' : 'What it did in these moments'}
        style={{ all: 'unset', cursor: 'pointer', display: 'flex', alignItems: 'flex-start', gap: 4, fontSize: 11, lineHeight: 1.45, color: tokens.muted }}
      >
        <Chevron size={12} style={{ flexShrink: 0, marginTop: 2 }} />
        <span>
          {`${n} moment${n === 1 ? '' : 's'}`}
          {changes.length > 0 && ` · ${changes.length} change${changes.length === 1 ? '' : 's'}`}
          {slept > 0 && ` · slept${slept > 1 ? ` ${slept} times` : ''}`}
          {!open && latest && <span style={{ color: tokens.text }}>{` · ${latest}`}</span>}
        </span>
      </button>
      {open && (
        <div style={{ margin: '6px 0 0 16px', paddingLeft: 8, borderLeft: `2px solid ${tokens.hairline}` }}>
          {b.moments.map(m => (
            <div key={m.seq ?? m.tick} style={{ display: 'flex', gap: 8, fontSize: 11, lineHeight: 1.5, color: m.result?.wrote ? tokens.text : tokens.muted }}>
              <span style={{ flexShrink: 0, width: 40, color: tokens.muted }}>{m.tick}</span>
              <span style={{ minWidth: 0 }}>
                {m.result?.ok ? m.result.summary : `tried, but ${m.result?.summary || 'did not choose'}`}
                {m.slept && <Moon size={10} style={{ marginLeft: 4, color: tokens.brand }} aria-label="slept" />}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function Message({ e }) {
  const mine = e.kind === 'you';
  const note = mine && e.pending ? (e.answered ? 'it keeps this in mind when it wakes' : 'it will hear this when it wakes') : null;
  const when = timeOf(e.at);
  return (
    <div className={`ai-message ai-message-${mine ? 'user' : 'ai'}`} style={{ alignSelf: mine ? 'flex-end' : 'flex-start', maxWidth: '85%' }}>
      <div className="ai-message-avatar">{mine ? <User size={24} /> : <Clover size={26} strokeWidth={1.75} aria-label="The Druid" />}</div>
      <div className="ai-message-content">
        <div className="ai-message-text" style={{ whiteSpace: 'pre-wrap' }}>{e.text}</div>
        {(when || note) && (
          <div className="ai-message-timestamp" style={{ textAlign: mine ? 'right' : 'left' }}>
            {[when, note].filter(Boolean).join(' · ')}
          </div>
        )}
      </div>
    </div>
  );
}

/** What it is doing now, while awake: its latest thought, or that it is working out an answer. */
function Now({ status, answering, thought, tokens }) {
  const label = answering ? 'thinking about what to say'
    : status === 'starting' ? 'waking up'
      : status === 'stopping' ? 'falling asleep'
        : thought || null;
  if (!answering && status === 'idle') return null;
  return (
    <div className="ai-thinking-row" style={{ alignItems: 'flex-start', maxWidth: '100%' }}>
      <div className="ai-message-avatar"><Clover size={26} strokeWidth={1.75} /></div>
      <div style={{ minWidth: 0, paddingTop: 4 }}>
        {label && (
          <div style={{ fontFamily: FONT, fontSize: 12, lineHeight: 1.45, color: tokens.muted, fontStyle: answering ? 'normal' : 'italic', display: '-webkit-box', WebkitLineClamp: 3, WebkitBoxOrient: 'vertical', overflow: 'hidden' }} title={label}>
            {label}
          </div>
        )}
        <span className="ai-thinking-dots"><span>•</span><span>•</span><span>•</span></span>
      </div>
    </div>
  );
}

function DruidChat({ stream, status, answering, tokens }) {
  const talk = asConversation(stream);
  const thought = [...stream].reverse().find(e => e.kind === 'moment' && e.thought)?.thought || null;
  if (!talk.length && status === 'idle' && !answering) {
    return (
      <div style={{ textAlign: 'center', display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '56px 8px', fontFamily: FONT }}>
        <Clover size={96} strokeWidth={1} color="var(--canvas-text-muted)" style={{ marginBottom: 16 }} />
        <div style={{ color: 'var(--canvas-text-muted)', fontSize: 14 }}>What shall we talk about?</div>
        <div style={{ color: tokens.muted, fontSize: 11, lineHeight: 1.5, marginTop: 10, maxWidth: 240 }}>
          Talk to it awake or asleep: it answers from what its universe holds. Wake it with the cup above to watch it work.
        </div>
      </div>
    );
  }
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16, padding: '16px 4px' }}>
      {talk.map((x, i) => (x.kind === 'between'
        ? <Between key={x.key} b={x} tokens={tokens} />
        : <Message key={x.seq ?? `m${i}`} e={x} />))}
      <Now status={status} answering={answering} thought={thought} tokens={tokens} />
    </div>
  );
}

export default memo(DruidChat);
