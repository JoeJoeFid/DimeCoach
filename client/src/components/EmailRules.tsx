// For the system administrator: emails that send themselves. Each rule says who it is for ("has
// not been active for more than 14 days") and what the email says. A rule starts switched off.
import { useCallback, useEffect, useState } from 'react';
import { api, type MailRule, type MailRuleDraft, type MailRulePreview, type MailRules } from '../api';
import { Field, Modal } from './bits';
import { confirmDialog } from './dialogs';

const PLACEHOLDERS: [string, string][] = [
  ['{first_name}', 'their first name'],
  ['{name}', 'their full name'],
  ['{days}', 'how many days it has been'],
  ['{link}', 'the button: put it on a line of its own'],
];
const people = (n: number) => `${n} ${n === 1 ? 'person' : 'people'}`;
const ago = (iso: string) => {
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86400000);
  return days < 1 ? 'today' : days === 1 ? 'yesterday' : `${days} days ago`;
};

export default function EmailRules({ run }: { run: (fn: () => Promise<unknown>, done?: string) => Promise<unknown> }) {
  const [state, setState] = useState<MailRules | null>(null);
  /** The rule being written: a new one has no id. */
  const [draft, setDraft] = useState<MailRuleDraft | null>(null);
  const load = useCallback(() => api.mailRules().then(setState, () => {}), []);
  useEffect(() => {
    load();
  }, [load]);
  if (!state) return null;

  const labelOf = (id: string) => state.triggers.find((t) => t.id === id)?.label ?? id;
  const start = () => {
    const t = state.triggers[0];
    setDraft({ name: '', trigger: t.id, days: t.days, subject: t.subject, body: t.body });
  };
  const toggle = async (r: MailRule) => {
    if (!r.enabled && r.waiting > 0) {
      const ok = await confirmDialog({
        title: `Turn on "${r.name}"?`,
        body: `${people(r.waiting)} already ${r.waiting === 1 ? 'fits' : 'fit'} this rule and will be emailed within ${state.every_minutes} minutes. After that it goes to each person as they come to fit it.`,
        confirmLabel: `Turn on and email ${people(r.waiting)}`,
      });
      if (!ok) return;
    }
    await run(async () => setState(await api.updateMailRule(r.id, { enabled: !r.enabled })), r.enabled ? `"${r.name}" is off. Nothing more will be sent.` : `"${r.name}" is on.`);
  };

  return (
    <div className="card email-rules">
      <div className="card-head">
        <h2>Automatic emails</h2>
        <button type="button" className="btn primary small" onClick={start}>
          + New automatic email
        </button>
      </div>
      <p className="muted small">
        Emails that send themselves when someone has been in a certain state for a while, such as invited and not set up, or not active. Dime Coach looks every {state.every_minutes} minutes, and each
        person gets a given email once. A new one starts switched off.
      </p>
      {!state.can_send && <p className="muted small">No email service is connected, so nothing will be sent until one is.</p>}
      {state.rules.length === 0 ? (
        <p className="muted">No automatic emails yet.</p>
      ) : (
        <ul className="email-rules-list">
          {state.rules.map((r) => (
            <li key={r.id}>
              <div className="email-rules-what">
                <strong>{r.name}</strong>
                <span className="muted small">
                  {labelOf(r.trigger)} for more than {r.days} {r.days === 1 ? 'day' : 'days'}
                </span>
                <span className="muted small">
                  {r.sent > 0 ? `Sent ${r.sent} ${r.sent === 1 ? 'time' : 'times'}, last ${ago(r.last_sent_at!)}` : 'Not sent to anyone yet'}
                  {r.waiting > 0 && ` · ${people(r.waiting)} ${r.enabled ? 'next in line' : 'would get it now'}`}
                </span>
              </div>
              <div className="seg" role="group" aria-label={`${r.name}: on or off`}>
                <button type="button" className={r.enabled ? 'on' : ''} aria-pressed={r.enabled} onClick={() => !r.enabled && toggle(r)}>
                  On
                </button>
                <button type="button" className={r.enabled ? '' : 'on'} aria-pressed={!r.enabled} onClick={() => r.enabled && toggle(r)}>
                  Off
                </button>
              </div>
              <button type="button" className="btn small" onClick={() => setDraft({ id: r.id, name: r.name, trigger: r.trigger, days: r.days, subject: r.subject, body: r.body })}>
                Edit
              </button>
            </li>
          ))}
        </ul>
      )}
      {draft && (
        <RuleEditor
          draft={draft}
          state={state}
          onClose={() => setDraft(null)}
          onSaved={(next, message) => {
            setState(next);
            setDraft(null);
            run(async () => {}, message);
          }}
          run={run}
        />
      )}
    </div>
  );
}

function RuleEditor({
  draft: first,
  state,
  onClose,
  onSaved,
  run,
}: {
  draft: MailRuleDraft;
  state: MailRules;
  onClose: () => void;
  onSaved: (next: MailRules, message: string) => void;
  run: (fn: () => Promise<unknown>, done?: string) => Promise<unknown>;
}) {
  const [d, setD] = useState(first);
  const [preview, setPreview] = useState<MailRulePreview | null>(null);
  const [error, setError] = useState('');
  const set = (patch: Partial<MailRuleDraft>) => setD((x) => ({ ...x, ...patch }));
  // Choosing a different "when" brings its own starting words, unless the words have been changed.
  const chooseTrigger = (id: string) => {
    const was = state.triggers.find((t) => t.id === d.trigger);
    const now = state.triggers.find((t) => t.id === id)!;
    const untouched = !!was && d.subject === was.subject && d.body === was.body;
    set(untouched ? { trigger: id, days: now.days, subject: now.subject, body: now.body } : { trigger: id });
  };
  // The preview follows the words, a moment after typing stops.
  useEffect(() => {
    let stale = false;
    const t = setTimeout(() => {
      api.previewMailRule(d).then(
        (p) => !stale && (setPreview(p), setError('')),
        (e) => !stale && (setPreview(null), setError((e as Error).message)),
      );
    }, 350);
    return () => {
      stale = true;
      clearTimeout(t);
    };
  }, [d]);
  const save = async () => {
    try {
      onSaved(d.id ? await api.updateMailRule(d.id, d) : await api.addMailRule(d), d.id ? 'Saved.' : 'Saved. It is switched off until you turn it on.');
    } catch (e) {
      setError((e as Error).message);
    }
  };
  const remove = async () => {
    const ok = await confirmDialog({ title: `Delete "${d.name || 'this automatic email'}"?`, body: 'It stops sending, and its record of who it was sent to is deleted.', confirmLabel: 'Delete', danger: true });
    if (!ok) return;
    try {
      onSaved(await api.deleteMailRule(d.id!), 'Deleted.');
    } catch (e) {
      setError((e as Error).message);
    }
  };

  return (
    <Modal title={d.id ? 'Automatic email' : 'New automatic email'} onClose={onClose} wide>
      <div className="email-rule-edit">
        <div className="email-rule-form">
          <Field label="Name, for your own list">
            <input className="input" value={d.name} placeholder="Such as: Invitation reminder" onChange={(e) => set({ name: e.target.value })} />
          </Field>
          <div className="email-rule-when">
            <Field label="Send it when someone" grow>
              <select className="input" value={d.trigger} onChange={(e) => chooseTrigger(e.target.value)}>
                {state.triggers.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.label}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="For more than">
              <span className="email-rule-days">
                <input className="input" type="number" min={1} max={365} value={d.days} onChange={(e) => set({ days: Number(e.target.value) })} />
                days
              </span>
            </Field>
          </div>
          <Field label="Subject">
            <input className="input" value={d.subject} onChange={(e) => set({ subject: e.target.value })} />
          </Field>
          <Field label="Message">
            <textarea className="input" rows={11} value={d.body} onChange={(e) => set({ body: e.target.value })} />
          </Field>
          <p className="muted small email-rule-help">
            These are filled in for each person:{' '}
            {PLACEHOLDERS.map(([code, what], i) => (
              <span key={code}>
                {i > 0 && ', '}
                <code>{code}</code> {what}
              </span>
            ))}
            . Leave a blank line between paragraphs.
          </p>
        </div>
        <div className="email-rule-preview">
          <span className="field-label">How it looks, written to you</span>
          {preview ? (
            <>
              <p className="email-samples-subject">
                <span className="muted small">Subject</span> <strong>{preview.subject}</strong>
              </p>
              <iframe className="email-samples-frame email-rule-frame" title="Preview of the email" sandbox="" srcDoc={preview.html} />
              <p className="muted small">
                {preview.waiting === 0
                  ? 'Nobody fits this right now.'
                  : `${people(preview.waiting)} ${preview.waiting === 1 ? 'fits' : 'fit'} this right now: ${preview.people.map((p) => `${p.name} (${p.days} days)`).join(', ')}${preview.waiting > preview.people.length ? ', and more' : ''}.`}
              </p>
            </>
          ) : (
            <p className="muted small">{error || 'Loading…'}</p>
          )}
        </div>
      </div>
      {error && preview && <p className="error">{error}</p>}
      <div className="modal-actions">
        {d.id && (
          <button type="button" className="btn danger" onClick={remove}>
            Delete
          </button>
        )}
        {d.id && (
          <button type="button" className="btn" disabled={!state.can_send} title={state.can_send ? 'Sends the saved version' : 'No email service is connected'} onClick={() => run(() => api.testMailRule(d.id!), 'A test was sent to your own address.')}>
            Send a test to me
          </button>
        )}
        <button type="button" className="btn" onClick={onClose}>
          Cancel
        </button>
        <button type="button" className="btn primary" onClick={save}>
          Save
        </button>
      </div>
    </Modal>
  );
}
