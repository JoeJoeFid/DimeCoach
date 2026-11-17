// For the system administrator: how many emails went out each day, and which ones. The search
// narrows it to one person, whether they received the email or caused it, or to a subject.
import { useEffect, useState } from 'react';
import { api, type EmailDay, type EmailLogMessage } from '../api';

const RANGES: [number, string][] = [
  [7, 'Last 7 days'],
  [30, 'Last 30 days'],
  [90, 'Last 90 days'],
  [365, 'Last year'],
];
/** "2026-11-17" as a day on this computer's calendar. */
const dayLabel = (day: string) => {
  const [y, m, d] = day.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric', year: y === new Date().getFullYear() ? undefined : 'numeric' });
};
const timeLabel = (at: string) => new Date(at).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
const count = (n: number) => `${n} email${n === 1 ? '' : 's'}`;

export default function EmailLog() {
  const [typed, setTyped] = useState('');
  const [q, setQ] = useState('');
  const [range, setRange] = useState(30);
  const [days, setDays] = useState<EmailDay[] | null>(null);
  /** The day whose emails are listed. */
  const [open, setOpen] = useState('');
  const [messages, setMessages] = useState<{ list: EmailLogMessage[]; more: boolean } | null>(null);
  const [failed, setFailed] = useState(false);

  // The search waits for a pause in typing.
  useEffect(() => {
    const t = setTimeout(() => setQ(typed.trim()), 300);
    return () => clearTimeout(t);
  }, [typed]);
  useEffect(() => {
    let stale = false;
    setOpen('');
    api.emailLog({ q, days: range }).then(
      (r) => {
        if (stale) return;
        setFailed(false);
        setDays(r.days);
      },
      () => !stale && setFailed(true),
    );
    return () => {
      stale = true;
    };
  }, [q, range]);
  useEffect(() => {
    if (!open) return;
    let stale = false;
    setMessages(null);
    api.emailLog({ q, days: range, day: open }).then(
      (r) => !stale && setMessages({ list: r.messages ?? [], more: !!r.more }),
      () => !stale && setMessages({ list: [], more: false }),
    );
    return () => {
      stale = true;
    };
  }, [open, q, range]);

  const total = (days ?? []).reduce((n, d) => n + d.count, 0);
  const unsent = (days ?? []).reduce((n, d) => n + d.unsent, 0);
  const most = Math.max(1, ...(days ?? []).map((d) => d.count));
  const rangeWords = RANGES.find(([n]) => n === range)![1].toLowerCase();

  return (
    <div className="card email-log">
      <h2>Emails sent</h2>
      <p className="muted small">Every email Dime Coach has sent, by day. Search for a person to see the emails they received and the ones that went out because of something they did, such as an invitation.</p>
      <div className="email-log-bar">
        <input className="input" type="search" aria-label="Search emails" placeholder="Search by name, email address or subject" value={typed} onChange={(e) => setTyped(e.target.value)} />
        <select className="input" aria-label="How far back" value={range} onChange={(e) => setRange(Number(e.target.value))}>
          {RANGES.map(([n, label]) => (
            <option key={n} value={n}>
              {label}
            </option>
          ))}
        </select>
      </div>
      {failed ? (
        <p className="error">The emails could not be loaded.</p>
      ) : days === null ? (
        <p className="muted">Loading…</p>
      ) : days.length === 0 ? (
        <p className="muted">{q ? `No emails match "${q}" in the ${rangeWords}.` : `No emails were sent in the ${rangeWords}.`}</p>
      ) : (
        <>
          <p className="email-log-total">
            <strong>{count(total)}</strong> in the {rangeWords}
            {q && ` matching "${q}"`}
            {unsent > 0 && <span className="email-log-unsent"> · {unsent} not sent</span>}
          </p>
          <ul className="email-log-days">
            {days.map((d) => (
              <li key={d.day}>
                <button type="button" className={`email-log-day ${open === d.day ? 'on' : ''}`} aria-expanded={open === d.day} onClick={() => setOpen(open === d.day ? '' : d.day)}>
                  <span className="email-log-date">{dayLabel(d.day)}</span>
                  <span className="email-log-track" aria-hidden="true">
                    <span style={{ width: `${(d.count / most) * 100}%` }} />
                  </span>
                  <span className="email-log-count">
                    {d.count}
                    {d.unsent > 0 && <span className="email-log-unsent"> ({d.unsent} not sent)</span>}
                  </span>
                </button>
                {open === d.day &&
                  (messages === null ? (
                    <p className="muted small email-log-wait">Loading…</p>
                  ) : (
                    <ul className="email-log-list">
                      {messages.list.map((m) => (
                        <li key={m.id}>
                          <span className="email-log-time">{timeLabel(m.at)}</span>
                          <span className="email-log-what">
                            <strong>{m.subject}</strong>
                            <span className="muted small">
                              To {m.to_name ? `${m.to_name} (${m.to_email})` : m.to_email}
                              {m.from_name && ` · because of ${m.from_name}`}
                            </span>
                          </span>
                          {!m.sent && <span className="email-log-unsent small">Not sent</span>}
                        </li>
                      ))}
                      {messages.more && <li className="muted small">Only the first {messages.list.length} of this day are shown. Search to narrow it down.</li>}
                    </ul>
                  ))}
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
