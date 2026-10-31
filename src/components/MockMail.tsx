import type { MouseEvent } from 'react';
import { FIELD_LABEL, T } from '../data/desktop';
import type { Action, MailMessage, MailState, VarKey } from '../data/schema';

interface Props {
  messages: MailMessage[];
  state: MailState;
  interactive?: boolean;
  /** Agent runs highlight what was read instead of a text selection. */
  agent?: boolean;
  onAction?: (a: Action) => void;
}

export function MockMail({ messages, state, interactive, agent, onAction }: Props) {
  const selected = messages.find((m) => m.id === state.selectedId) ?? null;

  const open = (m: MailMessage) => {
    if (!interactive) return;
    onAction?.({ kind: 'click', app: 'mail', target: T.message(m), messageId: m.id });
  };

  const onCopy = () => {
    if (!interactive) return;
    const sel = window.getSelection();
    const text = sel?.toString().trim() ?? '';
    if (!text) return;
    let el = sel?.anchorNode instanceof Element ? sel.anchorNode : sel?.anchorNode?.parentElement;
    let key = (el?.closest('[data-var]') as HTMLElement | null)?.dataset.var as VarKey | undefined;
    if (!key && selected) {
      for (const part of selected.body) if (typeof part !== 'string' && part.text === text) key = part.key;
    }
    onAction?.({
      kind: 'copy',
      app: 'mail',
      varKey: key,
      value: text,
      target: key ? T.value(key, text) : { tid: 'mail:body', role: 'Text', name: text.slice(0, 40), path: ['Mailbox', 'Reading pane', 'Message body'] },
    });
  };

  // Double-click selects the whole value (so "PO-4471" doesn't split at the hyphen).
  const selectAll = (e: MouseEvent<HTMLElement>) => {
    if (!interactive) return;
    const range = document.createRange();
    range.selectNodeContents(e.currentTarget);
    const sel = window.getSelection();
    sel?.removeAllRanges();
    sel?.addRange(range);
  };

  const unreadCount = messages.filter((m) => m.unread && m.id !== state.selectedId).length;

  return (
    <div className={`mm${interactive ? ' is-live' : ''}`}>
      <div className="mm-top">
        <span className="mm-brand">Mailbox</span>
        <span className="mm-search" aria-hidden>Search mail</span>
        <span className="mm-avatar" aria-hidden>BY</span>
      </div>
      <div className="mm-body">
        <nav className="mm-folders" aria-label="Folders">
          <span className="mm-folder is-active">Inbox <b>{unreadCount || ''}</b></span>
          <span className="mm-folder">Flagged</span>
          <span className="mm-folder">Sent</span>
          <span className="mm-folder">Archive</span>
        </nav>
        <ul className="mm-list" aria-label="Message list">
          {messages.map((m) => (
            <li
              key={m.id}
              role="option"
              aria-selected={m.id === state.selectedId}
              aria-label={m.subject}
              data-tid={`mail:msg:${m.id}`}
              className={`mm-item${m.id === state.selectedId ? ' is-selected' : ''}${m.unread && m.id !== state.selectedId ? ' is-unread' : ''}`}
              onClick={() => open(m)}
            >
              <div className="mm-item-top">
                <span className="mm-from">{m.fromName}</span>
                <span className="mm-time">{m.received}</span>
              </div>
              <div className="mm-subject">{m.subject}</div>
              <div className="mm-preview">{m.preview}</div>
            </li>
          ))}
        </ul>
        <article className="mm-read" aria-label="Reading pane" onCopy={onCopy}>
          {selected ? (
            <>
              <h2 className="mm-read-subject">{selected.subject}</h2>
              <div className="mm-read-from">
                <span className="mm-read-avatar" aria-hidden>{selected.fromName.split(' ').map((w) => w[0]).join('').slice(0, 2)}</span>
                <div>
                  <div><b>{selected.fromName}</b> &lt;{selected.fromEmail}&gt;</div>
                  <div className="mm-muted">To: Purchasing team, {selected.received}</div>
                </div>
              </div>
              <div className="mm-read-body" aria-label="Message body">
                {selected.body.map((part, i) =>
                  typeof part === 'string' ? (
                    <span key={i}>{part}</span>
                  ) : (
                    <span
                      key={i}
                      data-var={part.key}
                      data-tid={`mail:val:${part.key}`}
                      aria-label={`${FIELD_LABEL[part.key]}: ${part.text}`}
                      className={`mm-val${state.selection === part.key ? (agent ? ' is-read' : ' is-selected') : ''}`}
                      onDoubleClick={selectAll}
                    >
                      {part.text}
                    </span>
                  ),
                )}
              </div>
            </>
          ) : (
            <div className="mm-empty">Select a message to read it.</div>
          )}
        </article>
      </div>
    </div>
  );
}
