// Outgoing email.
//
// Every message is recorded in the outbox table, and marked sent once it has been handed off.
//   RESEND_API_KEY + PP_MAIL_FROM   messages are sent through Resend (resend.com)
//   PP_MAIL_TRANSPORT=log           messages are printed to the server console, which is enough
//                                   to try the registration flow on your own machine
// With neither, nothing leaves this server and registration stays closed.
import { AsyncLocalStorage } from 'node:async_hooks';
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

/**
 * The person signed in for the request being answered, so that an email can be written down as
 * their doing without every caller having to say so. See noteMailActor.
 */
const actor = new AsyncLocalStorage();
/** Called once a request is known to be someone's: emails sent while answering it are theirs. */
export const noteMailActor = (userId) => actor.enterWith(userId);

const markSent = (id) => run('UPDATE outbox SET sent_at=? WHERE id=?', new Date().toISOString(), id);

// --- How a message looks: the same words as the plain text, under the logo ---
// Mail programs do not show SVG, so the logo is a small PNG fetched from the site. It is only
// used when the file has been built and the site's public address is known.
const LOGO_FILE = path.join(import.meta.dirname, '..', 'dist', 'logo-mark.png');
const siteUrl = () => String(process.env.PP_PUBLIC_URL || '').trim().replace(/\/+$/, '');
const logoUrl = () => (/^https?:\/\//.test(siteUrl()) && fs.existsSync(LOGO_FILE) ? `${siteUrl()}/logo-mark.png` : '');
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
// Colors of the app, written out: mail programs do not read style sheets or variables.
const C = { page: '#f3f3f0', card: '#ffffff', ink: '#0d0d0e', ink2: '#48484d', muted: '#76767d', line: '#e3e3dd', band: '#0d0d0e', accent: '#d2f24b', accentInk: '#151b00', soft: '#f6f6f3' };
const FONT = "'Geist',Inter,-apple-system,'Segoe UI',Helvetica,Arial,sans-serif";
const LINK = /https?:\/\/[^\s<]+/g;
const linked = (escaped) => escaped.replace(LINK, (url) => `<a href="${url}" style="color:${C.ink};text-decoration:underline;word-break:break-all">${url}</a>`).replace(/\n/g, '<br>');
/** What to write on the button for a link, from the line that leads up to it: "Open it here:" becomes "Open it here". */
function buttonLabel(lead) {
  const words = String(lead || '').replace(/[:.]\s*$/, '').trim();
  if (words && words.length <= 44) return words;
  // Too long for a button: "Choose a password to finish setting up your account" is cut to "Choose a password".
  const short = words.split(' to ')[0];
  return short.length >= 8 && short.length <= 44 && short !== words ? short : 'Open in Dime Coach';
}

/**
 * The message as a page for mail programs that show one. It is built from the same words as the
 * plain text, which every message is written in, by reading how they are laid out:
 *  - a paragraph that is only a link becomes a button, named by the line before it
 *  - "Someone wrote:" followed by their words becomes a set-off note
 *  - a line followed by lines that start with "- " becomes a list
 *  - what comes after the button (how long the link lasts, what to do if it was a mistake) is small print
 * So a message looks right without anything extra being written for it.
 */
export function htmlFor(text, subject = '') {
  const logo = logoUrl();
  const site = siteUrl();
  const paragraphs = String(text)
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean);
  const blocks = [];
  let afterButton = false;
  for (let i = 0; i < paragraphs.length; i++) {
    const p = paragraphs[i];
    const lines = p.split('\n');
    const small = `margin:0 0 10px;font-size:13px;line-height:1.5;color:${C.muted}`;
    // Only a link: the thing to press. The line before it has already said what it is for.
    if (/^https?:\/\/\S+$/.test(p)) {
      const lead = paragraphs[i - 1] && /[:.]$/.test(paragraphs[i - 1]) ? paragraphs[i - 1].split('\n').pop() : '';
      blocks.push(
        `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:6px 0 14px"><tr><td style="border-radius:10px;background:${C.accent}">` +
          `<a href="${esc(p)}" style="display:inline-block;padding:13px 22px;font-size:15px;font-weight:700;color:${C.accentInk};text-decoration:none;border-radius:10px">${esc(buttonLabel(lead))} &rarr;</a>` +
          `</td></tr></table>` +
          `<p style="${small}">Or paste this link into your browser:<br><a href="${esc(p)}" style="color:${C.muted};word-break:break-all">${esc(p)}</a></p>`,
      );
      afterButton = true;
      continue;
    }
    // "Pat wrote:" and then what Pat wrote.
    if (lines.length > 1 && /^.{1,60} wrote:$/.test(lines[0])) {
      blocks.push(
        `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:4px 0 18px"><tr><td style="padding:14px 16px;border-left:4px solid ${C.accent};background:${C.soft};border-radius:0 10px 10px 0">` +
          `<div style="font-size:12px;font-weight:700;letter-spacing:0.04em;text-transform:uppercase;color:${C.muted};margin:0 0 6px">${esc(lines[0].replace(/:$/, ''))}</div>` +
          `<div style="font-size:15px;line-height:1.55;color:${C.ink}">${linked(esc(lines.slice(1).join('\n')))}</div>` +
          `</td></tr></table>`,
      );
      continue;
    }
    // A line, then a list under it.
    const items = lines.filter((l) => /^- /.test(l));
    if (items.length && items.length >= lines.length - 1) {
      const head = /^- /.test(lines[0]) ? '' : lines[0];
      blocks.push(
        `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:4px 0 18px;border:1px solid ${C.line};border-radius:10px"><tr><td style="padding:14px 16px">` +
          (head ? `<div style="font-size:13px;font-weight:700;color:${C.ink2};margin:0 0 8px">${esc(head.replace(/:$/, ''))}</div>` : '') +
          items
            .map((l, n) => {
              const m = /^- (.*?)(?: \(([^()]*)\))?$/.exec(l);
              return (
                `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="${n ? `border-top:1px solid ${C.line};` : ''}"><tr>` +
                `<td style="padding:7px 0;font-size:14px;color:${C.ink}">${esc(m[1])}</td>` +
                (m[2] ? `<td align="right" style="padding:7px 0 7px 12px;font-size:13px;color:${C.muted};white-space:nowrap">${esc(m[2])}</td>` : '') +
                `</tr></table>`
              );
            })
            .join('') +
          `</td></tr></table>`,
      );
      continue;
    }
    // The line that leads to a button says what the button is for: the button now says it, so the line goes quiet.
    const leadsToButton = /^https?:\/\/\S+$/.test(paragraphs[i + 1] || '') && /:$/.test(p) && lines.length === 1 && buttonLabel(p) === p.replace(/:$/, '').trim();
    if (leadsToButton) continue;
    blocks.push(afterButton ? `<p style="${small}">${linked(esc(p))}</p>` : `<p style="margin:0 0 16px;font-size:15px;line-height:1.6;color:${C.ink}">${linked(esc(p))}</p>`);
  }
  // The first words, shown beside the subject in the list of messages.
  const preview = esc(paragraphs.slice(1, 3).join(' ').replace(LINK, '').replace(/\s+/g, ' ').slice(0, 140));
  // The mark is drawn for a light page, so on the dark band it sits on a small white tile.
  const mark = logo ? `<span style="display:inline-block;vertical-align:middle;margin-right:10px;padding:4px 5px;border-radius:8px;background:#ffffff;line-height:0"><img src="${esc(logo)}" width="28" height="24" alt="" style="border:0"></span>` : '';
  return (
    `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light"><title>${esc(subject || 'Dime Coach')}</title></head>` +
    `<body style="margin:0;padding:0;background:${C.page};font-family:${FONT};color:${C.ink};-webkit-text-size-adjust:100%">` +
    `<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:${C.page}">${preview}</div>` +
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${C.page}"><tr><td align="center" style="padding:28px 12px">` +
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;border-radius:16px;overflow:hidden;border:1px solid ${C.line};background:${C.card}">` +
    `<tr><td style="background:${C.band};padding:18px 28px"><span style="font-size:18px;font-weight:700;letter-spacing:-0.02em;color:#ffffff">${mark}<span style="vertical-align:middle">Dime Coach</span></span></td></tr>` +
    `<tr><td style="height:4px;line-height:4px;font-size:0;background:${C.accent}">&nbsp;</td></tr>` +
    `<tr><td style="padding:28px 28px 18px">` +
    (subject ? `<h1 style="margin:0 0 18px;font-size:22px;line-height:1.25;letter-spacing:-0.02em;color:${C.ink}">${esc(subject)}</h1>` : '') +
    blocks.join('') +
    `</td></tr>` +
    `<tr><td style="padding:16px 28px 22px;border-top:1px solid ${C.line};font-size:12px;line-height:1.5;color:${C.muted}">` +
    `Dime Coach is where coaches plan practices, keep drills and draw plays.` +
    (site ? ` <a href="${esc(site)}" style="color:${C.muted}">${esc(site.replace(/^https?:\/\//, ''))}</a>` : '') +
    `</td></tr>` +
    `</table></td></tr></table></body></html>`
  );
}

/** Hands one message to Resend. Throws with Resend's own explanation when it is refused. */
async function viaResend({ to, subject, text }) {
  const r = await fetch(RESEND_URL, {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey()}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: from(), to: [to], subject, text, html: htmlFor(text, subject) }),
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
  const id = run('INSERT INTO outbox (to_email, subject, body, from_user) VALUES (?,?,?,?)', to, subject, kept, actor.getStore() ?? null).lastInsertRowid;
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
