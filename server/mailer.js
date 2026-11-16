// Outgoing email.
//
// Every message is recorded in the outbox table, and marked sent once it has been handed off.
//   RESEND_API_KEY + PP_MAIL_FROM   messages are sent through Resend (resend.com)
//   PP_MAIL_TRANSPORT=log           messages are printed to the server console, which is enough
//                                   to try the registration flow on your own machine
// With neither, nothing leaves this server and registration stays closed.
import fs from 'node:fs';
import path from 'node:path';
import { run } from './db.js';

const RESEND_URL = 'https://api.resend.com/emails';
const apiKey = () => (process.env.RESEND_API_KEY || '').trim();
/** The sender, such as "Dime Coach <hello@example.com>". Its domain must be verified with Resend. */
const from = () => (process.env.PP_MAIL_FROM || '').trim();

const transport = () => (process.env.PP_MAIL_TRANSPORT === 'log' ? 'log' : apiKey() && from() ? 'resend' : 'none');

/** configured is true only when a message can actually leave this server (or be read from its log). */
export const mailerStatus = () => ({ configured: transport() !== 'none', transport: transport() });

const markSent = (id) => run('UPDATE outbox SET sent_at=? WHERE id=?', new Date().toISOString(), id);

// --- How a message looks: the same words as the plain text, under the logo ---
// Mail programs do not show SVG, so the logo is a small PNG fetched from the site. It is only
// used when the file has been built and the site's public address is known.
const LOGO_FILE = path.join(import.meta.dirname, '..', 'dist', 'logo-mark.png');
const siteUrl = () => String(process.env.PP_PUBLIC_URL || '').trim().replace(/\/+$/, '');
const logoUrl = () => (/^https?:\/\//.test(siteUrl()) && fs.existsSync(LOGO_FILE) ? `${siteUrl()}/logo-mark.png` : '');
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
/** The message as a simple page: each paragraph of the text, with web addresses made into links. */
export function htmlFor(text) {
  const logo = logoUrl();
  const paragraphs = String(text)
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean)
    .map((p) => {
      const body = esc(p)
        .replace(/https?:\/\/[^\s<]+/g, (url) => `<a href="${url}" style="color:#1E6B4A;word-break:break-all">${url}</a>`)
        .replace(/\n/g, '<br>');
      return `<p style="margin:0 0 16px">${body}</p>`;
    })
    .join('');
  const mark = logo ? `<img src="${esc(logo)}" width="42" height="36" alt="" style="vertical-align:middle;border:0;margin-right:10px">` : '';
  return (
    '<!doctype html><html><body style="margin:0;padding:24px 12px;background:#F9FAFB;font-family:Inter,-apple-system,Segoe UI,Helvetica,Arial,sans-serif;color:#111827">' +
    '<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center">' +
    '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#ffffff;border:1px solid #E5E7EB;border-radius:12px"><tr><td style="padding:28px 28px 12px">' +
    `<div style="margin:0 0 22px;font-size:20px;font-weight:700;letter-spacing:-0.02em;color:#0F2B21">${mark}<span style="vertical-align:middle">Dime Coach</span></div>` +
    `<div style="font-size:15px;line-height:1.55">${paragraphs}</div>` +
    '</td></tr></table></td></tr></table></body></html>'
  );
}

/** Hands one message to Resend. Throws with Resend's own explanation when it is refused. */
async function viaResend({ to, subject, text }) {
  const r = await fetch(RESEND_URL, {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey()}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: from(), to: [to], subject, text, html: htmlFor(text) }),
    signal: AbortSignal.timeout(15000),
  });
  if (r.ok) return;
  const body = await r.json().catch(() => null);
  throw new Error(body?.message || `Resend answered ${r.status}`);
}

/**
 * Records the message and sends it. Resolves to { ok, error }: callers that do not need to know
 * the outcome (a confirmation link, say) can ignore the promise, and a failure is logged here.
 * `secret` is a code inside the text that must not be kept in the outbox.
 */
export async function sendMail({ to, subject, text, secret = '' }) {
  const kind = transport();
  // A link that signs someone in or changes a password is sent, but not written down here.
  const kept = secret ? text.split(secret).join('[code not kept]') : text;
  const id = run('INSERT INTO outbox (to_email, subject, body) VALUES (?,?,?)', to, subject, kept).lastInsertRowid;
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
