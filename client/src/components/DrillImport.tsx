// Bringing in drills a coach already has somewhere else. Two ways in, one way out:
//  - a spreadsheet, read here and matched to fields column by column;
//  - any other document, turned into a simple text format by the coach's own AI and pasted in.
// Both end at the same list to check over before anything is saved.
// Importing only ever adds drills. It never changes or removes one that is already there: a drill
// whose name is already taken is pointed out and left unticked, and ticking it adds a second one.
import { useMemo, useRef, useState } from 'react';
import Papa from 'papaparse';
import { api } from '../api';
import { useApp } from '../App';
import type { Drill, Tag } from '../types';
import { TAG_COLORS } from '../util';
import { Modal } from './bits';

type Cell = string | number | boolean | Date | null | undefined;
/** A drill as read from the file or the pasted text, before it is checked over. */
export interface FoundDrill {
  name: string;
  /** Null when no length was given. */
  minutes: number | null;
  categories: string[];
  notes_html: string;
  coach_notes_html: string;
  links: string[];
}

// --- Words to HTML --------------------------------------------------------------
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const inline = (s: string) =>
  esc(s)
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/__(.+?)__/g, '<strong>$1</strong>')
    .replace(/(^|[^*])\*([^*\s][^*]*?)\*(?!\*)/g, '$1<em>$2</em>');
/** Plain or lightly marked-up lines to the HTML the drill editor keeps: paragraphs, lists, bold. */
export function textToHtml(text: string): string {
  const out: string[] = [];
  let list: 'ul' | 'ol' | null = null;
  let para: string[] = [];
  const endPara = () => {
    if (para.length) out.push(`<p>${para.join('<br>')}</p>`);
    para = [];
  };
  const endList = () => {
    if (list) out.push(`</${list}>`);
    list = null;
  };
  for (const raw of text.replace(/\r/g, '').split('\n')) {
    const line = raw.trim();
    const bullet = /^[-*•]\s+(.*)$/.exec(line);
    const numbered = /^\d+[.)]\s+(.*)$/.exec(line);
    const heading = /^#{1,6}\s+(.*)$/.exec(line);
    if (!line) {
      endPara();
      endList();
    } else if (bullet || numbered) {
      endPara();
      const want = bullet ? 'ul' : 'ol';
      if (list !== want) {
        endList();
        out.push(`<${want}>`);
        list = want;
      }
      out.push(`<li>${inline((bullet || numbered)![1])}</li>`);
    } else if (heading) {
      endPara();
      endList();
      out.push(`<p><strong>${inline(heading[1].replace(/\*\*/g, ''))}</strong></p>`);
    } else {
      endList();
      para.push(inline(line));
    }
  }
  endPara();
  endList();
  return out.join('');
}
const splitList = (s: string) =>
  s
    .split(/[,;/|]/)
    .map((x) => x.replace(/\*\*/g, '').trim())
    .filter((x) => x && !/^(none|n\/a|-)$/i.test(x));
const firstNumber = (s: string) => {
  const m = /\d+/.exec(s);
  const n = m ? Number(m[0]) : NaN;
  return n > 0 && n <= 600 ? n : null;
};
const urlsIn = (s: string) => s.match(/https?:\/\/[^\s)>\]]+/g) ?? [];

// --- The text format --------------------------------------------------------------
const FIELD = /^[-*•]?\s*\**\s*(minutes?|duration|time|length|categor(?:y|ies)|tags?|coach(?:ing)?[ -]?(?:notes?|points?)|links?|urls?|videos?)\s*\**\s*[:：]\s*\**\s*(.*)$/i;
/** Reads the drills out of a reply in the format the instructions ask for. Forgiving about small departures from it. */
export function parseDrillText(text: string): { drills: FoundDrill[]; more: boolean } {
  const lines = text
    .replace(/\r/g, '')
    .split('\n')
    .filter((l) => !/^\s*```/.test(l));
  const levels = [0, 0, 0, 0];
  for (const l of lines) {
    const m = /^(#{1,3})\s+\S/.exec(l);
    if (m) levels[m[1].length]++;
  }
  // Each drill starts at a heading. Which size of heading is whichever there are most of.
  const level = levels[2] >= levels[1] && levels[2] >= levels[3] && levels[2] > 0 ? 2 : levels[1] >= levels[3] && levels[1] > 0 ? 1 : levels[3] > 0 ? 3 : 0;
  if (!level) return { drills: [], more: false };
  const start = new RegExp(`^#{${level}}\\s+(.+)$`);
  const drills: FoundDrill[] = [];
  let more = false;
  let cur: (FoundDrill & { body: string[]; coach: string[]; into: 'body' | 'coach' }) | null = null;
  const close = () => {
    if (!cur) return;
    const { body, coach, into: _into, ...d } = cur;
    drills.push({ ...d, notes_html: textToHtml(body.join('\n')), coach_notes_html: textToHtml(coach.join('\n')) });
    cur = null;
  };
  for (const l of lines) {
    const head = start.exec(l);
    if (head) {
      close();
      const name = head[1]
        .replace(/\*\*/g, '')
        .replace(/^(drill\s*\d*\s*[:.\-–]\s*|\d+[.)]\s*)/i, '')
        .trim();
      cur = { name, minutes: null, categories: [], notes_html: '', coach_notes_html: '', links: [], body: [], coach: [], into: 'body' };
      continue;
    }
    if (/^\s*(MORE\b|<!--\s*more)/i.test(l)) {
      more = true;
      continue;
    }
    if (!cur) continue;
    const f = FIELD.exec(l.trim());
    if (f) {
      const key = f[1].toLowerCase();
      const value = f[2].trim();
      if (/^(min|dur|time|len)/.test(key)) cur.minutes = firstNumber(value) ?? cur.minutes;
      else if (/^(cat|tag)/.test(key)) cur.categories.push(...splitList(value));
      else if (/^coach/.test(key)) {
        cur.into = 'coach';
        if (value) cur.coach.push(value);
      } else cur.links.push(...urlsIn(value));
      continue;
    }
    // A smaller heading inside a drill: "Coaching points" sends what follows to the coach's notes.
    const sub = /^#{1,6}\s+(.+)$/.exec(l.trim());
    if (sub && /^coach/i.test(sub[1].replace(/\*\*/g, ''))) {
      cur.into = 'coach';
      continue;
    }
    if (sub) cur.into = 'body';
    cur[cur.into].push(l);
  }
  close();
  return { drills: drills.filter((d) => d.name), more };
}

/** What to give the AI, with this coach's own categories in it. */
export function drillInstructions(sport: string, categories: string[]): string {
  return `I am moving my ${sport.toLowerCase()} drills into a coaching app. Read the file or text I give you and write every drill in it in the exact format below. Reply with only the drills, inside one code block so I can copy it, and nothing before or after.

FORMAT, one block like this per drill:

## Name of the drill
- Minutes: 10
- Categories: Category one, Category two
- Link: https://example.com/video

What the players do, as short paragraphs or a bulleted list. Keep my wording. Do not add advice of your own.

### Coaching points
- Things the coach should watch for or say, if my file has any.

RULES
- Start each drill with "## " and its name. Do not number the drills.
- Minutes is one whole number. If my file gives no length, leave the Minutes line out. Do not guess.
- ${categories.length ? `Categories must come from this list, spelled exactly: ${categories.join(', ')}. Use the one or two that fit best. If none fit, leave the Categories line out.` : 'Categories are one or two short words for what the drill works on, such as Shooting or Defense.'}
- Leave out the Link line and the Coaching points section when my file has none.
- Describe diagrams in a sentence if they matter. Pictures cannot be carried over.
- Include every drill. If there are more than 30, stop after 30 and write MORE on the last line, and I will ask you to continue.`;
}

// --- Spreadsheets -----------------------------------------------------------------
type FieldKey = 'name' | 'minutes' | 'categories' | 'notes' | 'coach' | 'link';
const FIELDS: { key: FieldKey; label: string; headers: string[] }[] = [
  { key: 'name', label: 'Name', headers: ['name', 'drill', 'drillname', 'title', 'activity'] },
  { key: 'minutes', label: 'Minutes', headers: ['minutes', 'min', 'mins', 'duration', 'time', 'length'] },
  { key: 'categories', label: 'Categories', headers: ['categories', 'category', 'tags', 'tag', 'focus', 'skill', 'type'] },
  { key: 'notes', label: 'Description', headers: ['description', 'notes', 'instructions', 'details', 'setup', 'how', 'explanation'] },
  { key: 'coach', label: 'Coach notes', headers: ['coachnotes', 'coachingpoints', 'coachingnotes', 'keypoints', 'points', 'cues'] },
  { key: 'link', label: 'Link', headers: ['link', 'url', 'video', 'videolink'] },
];
const TEMPLATE =
  'data:text/csv;charset=utf-8,' +
  encodeURIComponent('Name,Minutes,Categories,Description,Coach notes,Link\nShell drill,15,"Defense, Team defense","Four on four in the half court. Defenders jump to the ball on every pass.",Talk on every pass.,\n');
const cellText = (c: Cell) => (c == null ? '' : c instanceof Date ? c.toLocaleDateString() : String(c).trim());
const norm = (s: string) => s.toLowerCase().replace(/[^a-z]/g, '');
async function readRows(file: File): Promise<string[][]> {
  let rows: Cell[][];
  if (/\.xlsx$/i.test(file.name)) {
    const { readSheet } = await import('read-excel-file/browser');
    rows = (await readSheet(file)) as Cell[][];
  } else if (/\.xls$/i.test(file.name)) throw new Error('Old .xls files are not supported. Save the sheet as .xlsx or .csv and try again.');
  else rows = Papa.parse<string[]>(await file.text(), { skipEmptyLines: true }).data;
  return rows.map((r) => r.map(cellText)).filter((r) => r.some(Boolean));
}
type Mapping = Record<FieldKey, number>;
const guessMapping = (head: string[]): { mapping: Mapping; hasHeader: boolean } => {
  const mapping = Object.fromEntries(FIELDS.map((f) => [f.key, head.findIndex((h) => f.headers.includes(norm(h)))])) as Mapping;
  const hasHeader = mapping.name >= 0;
  // No recognizable header: take the columns in the template's order.
  if (!hasHeader) FIELDS.forEach((f, i) => (mapping[f.key] = i < head.length ? i : -1));
  return { mapping, hasHeader };
};
function rowsToDrills(rows: string[][], mapping: Mapping, hasHeader: boolean): FoundDrill[] {
  const at = (r: string[], k: FieldKey) => (mapping[k] >= 0 ? (r[mapping[k]] ?? '') : '');
  return rows
    .slice(hasHeader ? 1 : 0)
    .map((r) => ({
      name: at(r, 'name'),
      minutes: firstNumber(at(r, 'minutes')),
      categories: splitList(at(r, 'categories')),
      notes_html: textToHtml(at(r, 'notes')),
      coach_notes_html: textToHtml(at(r, 'coach')),
      links: urlsIn(at(r, 'link')),
    }))
    .filter((d) => d.name);
}

// --- The dialog -------------------------------------------------------------------
type Step = 'choose' | 'sheet' | 'ai' | 'review';
interface Row extends FoundDrill {
  key: number;
  include: boolean;
}
const sameName = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

export default function DrillImport({ existing, onClose, onDone }: { existing: Drill[]; onClose: () => void; onDone: (count: number) => void }) {
  const { sport, sportTags, reload } = useApp();
  const [step, setStep] = useState<Step>('choose');
  const [from, setFrom] = useState<'sheet' | 'ai'>('sheet');
  const [error, setError] = useState('');
  const [rows, setRows] = useState<Row[]>([]);
  const [more, setMore] = useState(false);
  // New categories the file names, and whether each is to be made.
  const [make, setMake] = useState<Record<string, boolean>>({});
  const [saving, setSaving] = useState('');
  // Names already in the library. Read again just before saving, in case it changed meanwhile.
  const [taken, setTaken] = useState(() => existing.map((e) => e.name));
  // Spreadsheet.
  const [sheet, setSheet] = useState<string[][] | null>(null);
  const [fileName, setFileName] = useState('');
  const [mapping, setMapping] = useState<Mapping | null>(null);
  const [hasHeader, setHasHeader] = useState(true);
  const fileInput = useRef<HTMLInputElement>(null);
  // AI.
  const [reply, setReply] = useState('');
  const [copied, setCopied] = useState(false);
  const textInput = useRef<HTMLInputElement>(null);
  const instructions = useMemo(() => drillInstructions(sport?.name ?? 'Basketball', sportTags.map((t) => t.name)), [sport?.name, sportTags]);

  const tagFor = (name: string): Tag | undefined => sportTags.find((t) => sameName(t.name, name));
  const review = (found: FoundDrill[], hasMore = false) => {
    if (found.length === 0) return setError(from === 'ai' ? 'No drills were found in that text. Each drill should start with a line like "## Name of the drill".' : 'No drills were found. Check that the Name column is the right one.');
    const seen = new Set<string>();
    const list = found.map((d, i) => {
      const dup = taken.some((n) => sameName(n, d.name)) || seen.has(d.name.trim().toLowerCase());
      seen.add(d.name.trim().toLowerCase());
      // Something already in the library, or listed twice, starts unticked.
      return { ...d, key: i, include: !dup };
    });
    const unknown = [...new Set(list.flatMap((d) => d.categories).filter((c) => !tagFor(c)).map((c) => c.trim()))];
    setMake(Object.fromEntries(unknown.map((c) => [c, true])));
    setRows(list);
    setMore(hasMore);
    setError('');
    setStep('review');
  };
  const onSheet = async (file?: File) => {
    if (!file) return;
    try {
      const data = await readRows(file);
      if (data.length === 0) throw new Error('That file has nothing in it.');
      const g = guessMapping(data[0]);
      setSheet(data);
      setFileName(file.name);
      setMapping(g.mapping);
      setHasHeader(g.hasHeader);
      setError('');
    } catch (e) {
      setError((e as Error).message);
    }
    if (fileInput.current) fileInput.current.value = '';
  };
  const patch = (key: number, p: Partial<Row>) => setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...p } : r)));
  const chosen = rows.filter((r) => r.include && r.name.trim());
  const unknown = Object.keys(make);
  /** Why a row needs a second look: its name is already in the library, or it is in this import twice. */
  const clash = (r: Row): 'library' | 'twice' | null =>
    !r.name.trim() ? null : taken.some((n) => sameName(n, r.name)) ? 'library' : rows.some((o) => o.key < r.key && sameName(o.name, r.name)) ? 'twice' : null;
  const clashes = rows.filter((r) => clash(r));
  const nameless = rows.filter((r) => !r.name.trim()).length;

  const save = async () => {
    if (!sport) return;
    try {
      // Look at the library once more. Anything that has since taken one of these names is pointed out
      // and unticked, and nothing is added until the list has been looked at again.
      setSaving('Checking your library…');
      const now = (await api.drills()).filter((d) => d.sport_id === sport.id).map((d) => d.name);
      const fresh = chosen.filter((r) => !taken.some((n) => sameName(n, r.name)) && now.some((n) => sameName(n, r.name)));
      setTaken(now);
      if (fresh.length > 0) {
        setRows((rs) => rs.map((r) => (fresh.some((f) => f.key === r.key) ? { ...r, include: false } : r)));
        setSaving('');
        return setError(
          `${fresh.length === 1 ? `"${fresh[0].name}" now has` : `${fresh.length} drills now have`} the same name as a drill in your library, so ${fresh.length === 1 ? 'it has' : 'they have'} been unticked. Nothing was added. Check the list and press Add again.`,
        );
      }
      // Categories first, so the drills can be filed under them.
      const tags = [...sportTags];
      const wanted = unknown.filter((c) => make[c] && chosen.some((r) => r.categories.some((x) => sameName(x, c))));
      for (const [i, name] of wanted.entries()) {
        setSaving(`Making the category ${name}…`);
        tags.push(await api.createTag({ sport_id: sport.id, name, color: TAG_COLORS[(sportTags.length + i) % TAG_COLORS.length], target_pct: null }));
      }
      let done = 0;
      for (const r of chosen) {
        setSaving(`Adding drill ${done + 1} of ${chosen.length}…`);
        const tag_ids = [...new Set(r.categories.map((c) => tags.find((t) => sameName(t.name, c))?.id).filter((id): id is number => !!id))];
        await api.createDrill({
          sport_id: sport.id,
          name: r.name.trim(),
          duration_min: r.minutes ?? 10,
          notes_html: r.notes_html,
          coach_notes_html: r.coach_notes_html,
          callout: '',
          groups: [],
          images: [],
          play_ids: [],
          videos: [],
          links: r.links.map((url) => ({ url, label: '' })),
          tag_ids,
        });
        done++;
      }
      if (wanted.length) await reload();
      onDone(done);
    } catch (e) {
      setSaving('');
      setError(`${(e as Error).message} Drills added before this are in your library.`);
    }
  };

  const title = step === 'choose' ? 'Import drills' : step === 'sheet' ? 'Import drills from a spreadsheet' : step === 'ai' ? 'Import drills from any document' : `Check ${rows.length} drill${rows.length === 1 ? '' : 's'} before adding`;
  return (
    <Modal title={title} onClose={onClose} wide>
      {error && <p className="error">{error}</p>}

      {step === 'choose' && (
        <>
          <p className="muted">Bring in drills you already have written down somewhere. You check the list before anything is added.</p>
          <div className="imp-choose">
            <button
              type="button"
              onClick={() => {
                setFrom('sheet');
                setStep('sheet');
              }}
            >
              <strong>From a spreadsheet</strong>
              <span>An Excel or CSV file with one drill on each row. You say which column is which.</span>
            </button>
            <button
              type="button"
              onClick={() => {
                setFrom('ai');
                setStep('ai');
              }}
            >
              <strong>From any document, using your own AI</strong>
              <span>Word files, PDFs, notes or a messy sheet. ChatGPT, Claude or Gemini rewrites it, and you paste the result here.</span>
            </button>
          </div>
        </>
      )}

      {step === 'sheet' && (
        <>
          <p className="muted small">
            Choose an .xlsx or .csv file with a row for each drill. Only a name is needed.{' '}
            <a href={TEMPLATE} download="drills-template.csv">
              Download a template
            </a>{' '}
            to see the columns.
          </p>
          <input ref={fileInput} type="file" accept=".csv,.xlsx,.xls" hidden onChange={(e) => onSheet(e.target.files?.[0])} />
          <button type="button" className="btn" onClick={() => fileInput.current?.click()}>
            {sheet ? 'Choose a different file' : 'Choose a file'}
          </button>
          {sheet && mapping && (
            <>
              <p className="imp-file">
                <strong>{fileName}</strong> · {sheet.length - (hasHeader ? 1 : 0)} rows
              </p>
              <label className="check">
                <input type="checkbox" checked={hasHeader} onChange={(e) => setHasHeader(e.target.checked)} />
                <span>The first row is column names, not a drill</span>
              </label>
              <div className="imp-map">
                {FIELDS.map((f) => (
                  <label key={f.key} className="field">
                    <span className="field-label">
                      {f.label}
                      {f.key === 'name' ? ' (needed)' : ''}
                    </span>
                    <select className="input" value={mapping[f.key]} onChange={(e) => setMapping({ ...mapping, [f.key]: Number(e.target.value) })}>
                      <option value={-1}>Not in this file</option>
                      {sheet[0].map((h, i) => (
                        <option key={i} value={i}>
                          {hasHeader && h ? h : `Column ${i + 1}`}
                          {!hasHeader && h ? ` (${h.slice(0, 24)})` : ''}
                        </option>
                      ))}
                    </select>
                  </label>
                ))}
              </div>
            </>
          )}
          <div className="modal-actions">
            <button className="btn" onClick={() => setStep('choose')}>
              Back
            </button>
            <button className="btn primary" disabled={!sheet || !mapping || mapping.name < 0} onClick={() => review(rowsToDrills(sheet!, mapping!, hasHeader))}>
              Read the drills
            </button>
          </div>
        </>
      )}

      {step === 'ai' && (
        <>
          <ol className="imp-steps">
            <li>
              <strong>Copy these instructions.</strong> They include your own categories, so the drills come back filed the way you file them.
              <textarea className="input imp-text" readOnly rows={5} value={instructions} aria-label="Instructions for your AI" onFocus={(e) => e.target.select()} />
              <button
                type="button"
                className="btn"
                onClick={async () => {
                  try {
                    await navigator.clipboard.writeText(instructions);
                    setCopied(true);
                    window.setTimeout(() => setCopied(false), 2000);
                  } catch {
                    setError('Copying was blocked by the browser. Click in the box above, which selects it all, and copy it yourself.');
                  }
                }}
              >
                {copied ? 'Copied' : 'Copy the instructions'}
              </button>
            </li>
            <li>
              <strong>Paste them into your AI</strong> (ChatGPT, Claude, Gemini or another) and attach your file, or paste your drills in after them.
            </li>
            <li>
              <strong>Paste its reply here</strong>, or{' '}
              <button type="button" className="link" onClick={() => textInput.current?.click()}>
                choose the file it gave you
              </button>
              .
              <input
                ref={textInput}
                type="file"
                accept=".md,.markdown,.txt,text/plain,text/markdown"
                hidden
                onChange={async (e) => {
                  const f = e.target.files?.[0];
                  if (f) setReply(await f.text());
                  e.target.value = '';
                }}
              />
              <textarea className="input imp-text" rows={8} value={reply} placeholder={'## Shell drill\n- Minutes: 15\n- Categories: Defense\n\nFour on four in the half court…'} aria-label="The reply from your AI" onChange={(e) => setReply(e.target.value)} />
            </li>
          </ol>
          <div className="modal-actions">
            <button className="btn" onClick={() => setStep('choose')}>
              Back
            </button>
            <button
              className="btn primary"
              disabled={!reply.trim()}
              onClick={() => {
                const got = parseDrillText(reply);
                review(got.drills, got.more);
              }}
            >
              Read the drills
            </button>
          </div>
        </>
      )}

      {step === 'review' && (
        <>
          <p className="imp-summary">
            <strong>
              {chosen.length} of {rows.length} will be added.
            </strong>{' '}
            Importing only adds drills. The ones you already have are never changed or removed.
            {clashes.length > 0 &&
              ` ${clashes.length} ${clashes.length === 1 ? 'has a name that is' : 'have names that are'} already taken and ${clashes.length === 1 ? 'starts' : 'start'} unticked. Rename ${clashes.length === 1 ? 'it' : 'them'}, or tick ${clashes.length === 1 ? 'it' : 'them'} to add a second drill with the same name.`}
            {nameless > 0 && ` ${nameless} with no name will be left out.`}
          </p>
          {more && <p className="banner">The reply says there are more drills to come. Add these, then ask your AI to continue and import that reply the same way.</p>}
          {unknown.length > 0 && (
            <div className="imp-newcats">
              <strong>Categories you do not have yet.</strong> <span className="muted small">Ticked ones are made for you. Unticked ones are left off the drills.</span>
              <div>
                {unknown.map((c) => (
                  <label key={c} className="check">
                    <input type="checkbox" checked={make[c]} onChange={(e) => setMake({ ...make, [c]: e.target.checked })} />
                    <span>{c}</span>
                  </label>
                ))}
              </div>
            </div>
          )}
          <div className="table-scroll imp-scroll">
            <table className="table imp-table">
              <thead>
                <tr>
                  <th>
                    <input type="checkbox" aria-label="Add all" checked={rows.every((r) => r.include)} onChange={(e) => setRows(rows.map((r) => ({ ...r, include: e.target.checked })))} />
                  </th>
                  <th>Name</th>
                  <th>Minutes</th>
                  <th>Categories</th>
                  <th>Description</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.key} className={`${r.include ? '' : 'off'} ${clash(r) ? 'clash' : ''}`}>
                    <td>
                      <input type="checkbox" aria-label={`Add ${r.name}`} checked={r.include} onChange={(e) => patch(r.key, { include: e.target.checked })} />
                    </td>
                    <td>
                      <input className="input" aria-label="Name" value={r.name} onChange={(e) => patch(r.key, { name: e.target.value })} />
                      {clash(r) === 'library' && (
                        <span className="imp-flag">{r.include ? 'Will be added as a second drill with this name. The one you have is not changed.' : 'You already have a drill with this name'}</span>
                      )}
                      {clash(r) === 'twice' && <span className="imp-flag">{r.include ? 'Will be added again: this name is in the import twice' : 'This name is in the import twice'}</span>}
                      {!r.name.trim() && <span className="imp-flag">Needs a name to be added</span>}
                    </td>
                    <td>
                      <input
                        className="input imp-min"
                        type="number"
                        min={1}
                        max={600}
                        aria-label="Minutes"
                        placeholder="10"
                        value={r.minutes ?? ''}
                        onChange={(e) => patch(r.key, { minutes: e.target.value ? Math.max(1, Math.min(600, Number(e.target.value))) : null })}
                      />
                      {r.minutes === null && <span className="imp-flag">No length given: 10</span>}
                    </td>
                    <td>
                      <span className="chips">
                        {r.categories.map((c) => {
                          const tag = tagFor(c);
                          const dropped = !tag && !make[c.trim()];
                          return (
                            <span key={c} className={`chip ${dropped ? 'imp-dropped' : ''}`} title={dropped ? 'Left off, because this category is not being made' : tag ? '' : 'A new category'}>
                              <span className="dot" style={{ background: tag?.color ?? 'var(--muted)' }} />
                              {tag?.name ?? c}
                              {!tag && !dropped && <em> new</em>}
                              <button type="button" aria-label={`Take ${c} off ${r.name}`} onClick={() => patch(r.key, { categories: r.categories.filter((x) => x !== c) })}>
                                ✕
                              </button>
                            </span>
                          );
                        })}
                      </span>
                    </td>
                    <td>
                      <div className="imp-notes rich" dangerouslySetInnerHTML={{ __html: r.notes_html || '<span class="muted">None</span>' }} />
                      {(r.coach_notes_html || r.links.length > 0) && (
                        <span className="muted small">{[r.coach_notes_html && 'has coach notes', r.links.length > 0 && `${r.links.length} link${r.links.length === 1 ? '' : 's'}`].filter(Boolean).join(' · ')}</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="modal-actions">
            {saving && <span className="muted small imp-saving">{saving}</span>}
            <button className="btn" disabled={!!saving} onClick={() => setStep(from)}>
              Back
            </button>
            <button className="btn primary" disabled={chosen.length === 0 || !!saving} onClick={save}>
              {saving ? 'Adding…' : `Add ${chosen.length} drill${chosen.length === 1 ? '' : 's'}`}
            </button>
          </div>
        </>
      )}
    </Modal>
  );
}
