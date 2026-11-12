// Outgoing email.
//
// Every message is recorded in the outbox table, and marked sent once it has been handed off.
//   RESEND_API_KEY + PP_MAIL_FROM   messages are sent through Resend (resend.com)
//   PP_MAIL_TRANSPORT=log           messages are printed to the server console, which is enough
//                                   to try the registration flow on your own machine
// With neither, nothing leaves this server and registration stays closed.
import { run } from './db.js';

const RESEND_URL = 'https://api.resend.com/emails';
const apiKey = () => (process.env.RESEND_API_KEY || '').trim();
/** The sender, such as "Dime Coach <hello@example.com>". Its domain must be verified with Resend. */
const from = () => (process.env.PP_MAIL_FROM || '').trim();

const transport = () => (process.env.PP_MAIL_TRANSPORT === 'log' ? 'log' : apiKey() && from() ? 'resend' : 'none');

/** configured is true only when a message can actually leave this server (or be read from its log). */
export const mailerStatus = () => ({ configured: transport() !== 'none', transport: transport() });

const markSent = (id) => run('UPDATE outbox SET sent_at=? WHERE id=?', new Date().toISOString(), id);

/** Hands one message to Resend. Throws with Resend's own explanation when it is refused. */
async function viaResend({ to, subject, text }) {
  const r = await fetch(RESEND_URL, {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey()}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: from(), to: [to], subject, text }),
    signal: AbortSignal.timeout(15000),
  });
  if (r.ok) return;
  const body = await r.json().catch(() => null);
  throw new Error(body?.message || `Resend answered ${r.status}`);
}

/**
 * Records the message and sends it. Resolves to { ok, error }: callers that do not need to know
 * the outcome (a confirmation link, say) can ignore the promise, and a failure is logged here.
 */
export async function sendMail({ to, subject, text }) {
  const kind = transport();
  const id = run('INSERT INTO outbox (to_email, subject, body) VALUES (?,?,?)', to, subject, text).lastInsertRowid;
  if (kind === 'none') return { ok: false, error: 'No email service is connected.' };
  if (kind === 'log') {
    console.log(`\n--- email to ${to} ---\nSubject: ${subject}\n\n${text}\n--- end ---\n`);
    markSent(id);
    return { ok: true };
  }
  try {
    await viaResend({ to, subject, text });
    markSent(id);
    return { ok: true };
  } catch (e) {
    console.error(`Email to ${to} was not sent: ${e.message}`);
    return { ok: false, error: e.message };
  }
}
