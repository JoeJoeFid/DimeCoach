// Outgoing email. There is no real email service connected yet.
//
// Every message is recorded in the outbox table. With PP_MAIL_TRANSPORT=log the message is also
// printed to the server console, which is enough to try the registration flow on your own machine.
// To go live, add a transport here that hands the message to an email service, and return
// configured: true from mailerStatus() when its settings are present.
import { run } from './db.js';

const transport = () => (process.env.PP_MAIL_TRANSPORT === 'log' ? 'log' : 'none');

/** configured is true only when a message can actually leave this server (or be read from its log). */
export const mailerStatus = () => ({ configured: transport() !== 'none', transport: transport() });

/** Returns true if the message was handed off. */
export function sendMail({ to, subject, text }) {
  const sent = transport() === 'log';
  run('INSERT INTO outbox (to_email, subject, body, sent_at) VALUES (?,?,?,?)', to, subject, text, sent ? new Date().toISOString() : null);
  if (sent) console.log(`\n--- email to ${to} ---\nSubject: ${subject}\n\n${text}\n--- end ---\n`);
  return sent;
}
