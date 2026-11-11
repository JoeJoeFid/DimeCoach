// Turns an old practice plan (photo, PDF, Word file or text) into a structured draft.
//
// No API key is involved. Two routes produce the same draft:
//   1. Automatic: the server runs the Claude Code program installed on this computer
//      ("claude -p"), which uses the coach's normal Claude login.
//   2. Manual: the coach copies a prompt into claude.ai with the file, then pastes the reply back.
// Nothing is saved here. The coach reviews the draft in the browser first.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { z } from 'zod';
import mammoth from 'mammoth';

export class ImportError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}

const text = z.string().nullish().transform((v) => v ?? '');
const DraftSchema = z.object({
  title: text,
  date: text,
  start_time: text,
  location: text,
  items: z.array(
    z.object({
      kind: z.enum(['item', 'break']).catch('item'),
      title: text,
      duration_min: z.coerce.number().catch(10),
      notes_html: text,
      callout: text,
      groups: z
        .array(z.object({ name: text, notes_html: text, player_names: z.array(z.string()).nullish().transform((v) => v ?? []) }))
        .nullish()
        .transform((v) => v ?? []),
      tags: z.array(z.string()).nullish().transform((v) => v ?? []),
    }),
  ),
  new_tags: z.array(z.object({ name: z.string(), reason: text })).nullish().transform((v) => v ?? []),
  warnings: z.array(z.string()).nullish().transform((v) => v ?? []),
});

const INSTRUCTIONS = `You convert a coach's old practice plan into structured data for a practice-planning app. The coach will review your draft before it is saved, so be faithful to the document and say what you were unsure about rather than inventing detail.

How the app models a practice:
- A practice is an ordered list of items. Each item has a title, a length in whole minutes, and optional notes. The app computes clock times itself: each item starts when the previous one ends, beginning at start_time.
- Because times cascade, any gap between two timed items in the document must become its own item with kind "break" (title "Break" unless the document says what it was), sized to fill the gap. Explicit water breaks are also kind "break". Breaks have no notes, groups or tags.
- If the document gives clock times, derive each duration from them. If it gives only durations, use those. If it gives neither, estimate sensible durations and add a warning that the times are estimates.
- Notes are HTML restricted to these tags: p, ul, ol, li, strong, em, u. Keep the document's own wording, list nesting and emphasis. Each li wraps its text in a p. Do not put the item title or its time in the notes.
- When an item has side-by-side columns, boxes or stations with their own instructions, make each one a group with its notes in that group's notes_html. When an item has a grid or lists of player names (teams, squads, lines), make each column or list a group and put the names in player_names exactly as written. Read a name grid column by column: each column is one group.
- A short standalone rule or reminder under an item (for example a line starting "RULE:") goes at the end of that item's notes as its own bold paragraph.

Categories (tags):
- Each non-break item gets one to three categories describing the skill or objective it trains. Categories are high-level learning objectives such as "Shooting" or "Ball handling", not drill names.
- Use an existing category whenever one reasonably fits, spelled exactly as given. Only when the plan works on a theme that no existing category covers, propose a new one in new_tags and use that same name in the item's tags. Keep new categories few, general and reusable across many practices, and in the same naming style as the existing ones.

Dates: the document may omit the year or write it with two digits. Resolve it to the most recent date on or before today that matches what is written, and add a warning if you had to assume the year.

Reply with one JSON object and nothing else: no explanation before or after it, and no code fence. Use exactly this shape:
{
  "title": "short title such as Practice, without the date or location",
  "date": "YYYY-MM-DD, or empty string if the document gives no date",
  "start_time": "24-hour HH:MM of the first item, or empty string if the document gives no times",
  "location": "where it was held, or empty string",
  "items": [
    {
      "kind": "item or break",
      "title": "string",
      "duration_min": 10,
      "notes_html": "HTML or empty string",
      "groups": [{ "name": "string or empty", "notes_html": "HTML or empty", "player_names": ["names in order"] }],
      "tags": ["category names"]
    }
  ],
  "new_tags": [{ "name": "string", "reason": "one short sentence on what in the plan this category covers" }],
  "warnings": ["anything you had to guess or could not read"]
}`;

const today = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
const context = (sport, tagNames) =>
  `Sport: ${sport}\nToday's date: ${today()}\nExisting categories: ${tagNames.length ? tagNames.join(', ') : '(none yet)'}`;

/** The prompt a coach can paste into claude.ai along with their file. */
export function manualPrompt(sport, tagNames) {
  return `${INSTRUCTIONS}\n\n${context(sport, tagNames)}\n\nThe practice plan is the file or text I am attaching to this message. Convert it into a draft practice.`;
}

/** Validates a draft that came back from Claude as text. Tolerates a code fence or stray words around the JSON. */
export function parseDraft(reply) {
  const raw = String(reply || '');
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  if (start < 0 || end <= start) throw new ImportError('That reply does not contain a draft. Paste the whole reply from Claude, starting with the { character.');
  let data;
  try {
    data = JSON.parse(raw.slice(start, end + 1));
  } catch {
    throw new ImportError('The draft from Claude was cut off or damaged. Ask Claude to send the JSON again, then paste the whole reply.');
  }
  const parsed = DraftSchema.safeParse(data);
  if (!parsed.success) throw new ImportError('The draft from Claude is missing parts the app needs. Try the import again.');
  const draft = parsed.data;
  for (const it of draft.items) {
    it.duration_min = Math.max(0, Math.round(it.duration_min) || 0);
    // Older replies may still carry a separate callout. It belongs in the notes now.
    if (it.callout.trim()) it.notes_html += `<p><strong>${it.callout.trim().replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')}</strong></p>`;
    it.callout = '';
    if (it.kind === 'break') Object.assign(it, { notes_html: '', groups: [], tags: [] });
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(draft.date)) draft.date = '';
  if (!/^\d{2}:\d{2}$/.test(draft.start_time)) draft.start_time = '';
  return draft;
}

// --- Automatic route: the local Claude Code program ------------------------

/** Runs `claude` with simple arguments only, so it works whether it is installed as an .exe or a .cmd shim. */
function runClaude(args, { input = '', cwd, timeoutMs }) {
  return new Promise((resolve, reject) => {
    // On Windows `claude` may be a .cmd shim, which needs a shell. The arguments are fixed words, never user input.
    const child =
      process.platform === 'win32'
        ? spawn(['claude', ...args].join(' '), { cwd, shell: true, windowsHide: true })
        : spawn('claude', args, { cwd });
    let out = '';
    let err = '';
    const timer = setTimeout(() => {
      // On Windows the process runs under a shell, so end the whole tree.
      if (process.platform === 'win32' && child.pid) spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true });
      else child.kill();
      reject(new ImportError('Claude took too long to read this plan. Try again, or split the plan into smaller files.', 504));
    }, timeoutMs);
    child.stdout.on('data', (d) => (out += d));
    child.stderr.on('data', (d) => (err += d));
    child.on('error', () => {
      clearTimeout(timer);
      reject(new ImportError('Claude Code is not installed on this computer, so automatic import is unavailable. Use the claude.ai option instead.', 501));
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({ code, out, err });
    });
    child.stdin.on('error', () => {});
    child.stdin.end(input);
  });
}

let statusCache = null;
/** Whether the Claude Code program is installed here. Checked once, then remembered for a minute. */
export async function claudeStatus() {
  if (statusCache && Date.now() - statusCache.at < 60_000) return statusCache.value;
  let value = { available: false, version: '' };
  try {
    const r = await runClaude(['--version'], { timeoutMs: 15_000 });
    if (r.code === 0 && r.out.trim()) value = { available: true, version: r.out.trim().split('\n')[0] };
  } catch {
    /* not installed */
  }
  statusCache = { at: Date.now(), value };
  return value;
}

const IMAGE_EXT = { 'image/jpeg': '.jpg', 'image/png': '.png', 'image/gif': '.gif', 'image/webp': '.webp' };
const DOCX = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

/** Works out how Claude should receive the plan: as text inside the prompt, or as a file to open. */
async function prepareSource(source, dir) {
  if (typeof source?.text === 'string' && source.text.trim()) return { inline: source.text };
  const name = String(source?.name || 'file');
  const type = String(source?.media_type || '').toLowerCase();
  const data = String(source?.data || '');
  if (!data) throw new ImportError('The file was empty.');
  const buffer = Buffer.from(data, 'base64');

  if (type === DOCX || /\.docx$/i.test(name)) {
    const { value } = await mammoth.convertToHtml({ buffer });
    if (!value.trim()) throw new ImportError(`No readable text was found in ${name}.`);
    return { inline: value };
  }
  if (type.startsWith('text/') || /\.(txt|md|csv|html?)$/i.test(name)) {
    const str = buffer.toString('utf8');
    if (!str.trim()) throw new ImportError(`${name} is empty.`);
    return { inline: str };
  }
  const ext = IMAGE_EXT[type] || (type === 'application/pdf' || /\.pdf$/i.test(name) ? '.pdf' : '');
  if (!ext) throw new ImportError(`${name} is not a supported file type. Use a photo, PDF, Word (.docx) or text file.`);
  // The file gets a fixed name of our own, never the uploaded one.
  const file = path.join(dir, `plan${ext}`);
  fs.writeFileSync(file, buffer);
  return { file: `plan${ext}` };
}

export async function analyzePlan({ source, sport, tagNames }) {
  // Claude works inside an empty folder that holds only this upload.
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'practiceplan-import-'));
  try {
    const src = await prepareSource(source, dir);
    const prompt =
      `${INSTRUCTIONS}\n\n${context(sport, tagNames)}\n\n` +
      (src.inline !== undefined
        ? `The practice plan follows between the markers.\n<practice_plan>\n${src.inline}\n</practice_plan>\n\nConvert it into a draft practice.`
        : `The practice plan is the file ${src.file} in the current folder. Open it with the Read tool, then convert it into a draft practice.`);

    // Read is the only tool Claude may use, and only inside the upload folder.
    const args = ['-p', '--output-format', 'json', '--tools', 'Read', '--allowedTools', 'Read', '--strict-mcp-config', '--no-session-persistence'];
    const r = await runClaude(args, { input: prompt, cwd: dir, timeoutMs: 5 * 60_000 });

    let envelope = null;
    try {
      envelope = JSON.parse(r.out);
    } catch {
      /* handled below */
    }
    const reply = typeof envelope?.result === 'string' ? envelope.result : '';
    if (r.code !== 0 || envelope?.is_error || !reply) {
      const detail = `${reply} ${r.err}`.trim();
      if (/log ?in|logged in|authenticat|credential|api key|\/login/i.test(detail))
        throw new ImportError('Claude Code is not signed in. Open a terminal, run "claude", sign in, then try again.', 401);
      if (/limit|quota|overloaded/i.test(detail))
        throw new ImportError('Claude is at its usage limit right now. Try again later, or use the claude.ai option.', 429);
      console.error('claude -p failed:', r.code, detail.slice(0, 500));
      throw new ImportError('Claude could not read this plan. Try again, or use the claude.ai option.', 502);
    }
    return parseDraft(reply);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}
