// Shared pieces of the "import an old plan" flow, used by the Import page (new practices)
// and by the practice editor (import into an existing practice).
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { api, newKey, type AiStatus, type ImportSource } from '../api';
import type { Drill, ImportDraft, Item, Player, Tag, Team } from '../types';
import { TAG_COLORS, blankItem, clean, isBlankHtml, schedule, slotLabel } from '../util';
import { Field } from './bits';

export const same = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

/** What the coach decided while reviewing a draft. */
export interface DraftChoices {
  /** New category names to add. */
  acceptTags: Set<string>;
  addPlayers: boolean;
  /** Titles of new items the coach chose NOT to add to the drill library. Everything else new is added. */
  skipDrills: Set<string>;
}
export const defaultChoices = (draft: ImportDraft): DraftChoices => ({
  acceptTags: new Set(draft.new_tags.map((t) => t.name)),
  addPlayers: true,
  skipDrills: new Set(),
});

/** Items in the draft that the drill library does not have yet, by name. Breaks and untitled items never count. */
export function newDrillTitles(draft: ImportDraft, drills: Drill[], sportId: number) {
  const titles: string[] = [];
  for (const it of draft.items) {
    const title = it.title.trim();
    if (it.kind !== 'item' || !title) continue;
    if (drills.some((d) => d.sport_id === sportId && same(d.name, title)) || titles.some((t) => same(t, title))) continue;
    titles.push(title);
  }
  return titles;
}

/** Phone photos are often very large. Shrink them to a readable size before upload. */
export async function prepareFile(file: File): Promise<ImportSource> {
  const toBase64 = (blob: Blob) =>
    new Promise<string>((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(String(r.result).split(',')[1] || '');
      r.onerror = () => reject(new Error(`Could not read ${file.name}.`));
      r.readAsDataURL(blob);
    });
  if (file.type.startsWith('image/')) {
    const bitmap = await createImageBitmap(file).catch(() => null);
    if (!bitmap) throw new Error(`${file.name} is not an image this browser can open. Save it as JPEG or PNG.`);
    const scale = Math.min(1, 2400 / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    canvas.getContext('2d')!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob | null>((res) => canvas.toBlob(res, 'image/jpeg', 0.9));
    if (!blob) throw new Error(`Could not prepare ${file.name}.`);
    return { name: file.name, media_type: 'image/jpeg', data: await toBase64(blob) };
  }
  if (file.size > 30 * 1024 * 1024) throw new Error(`${file.name} is larger than 30 MB.`);
  return { name: file.name, media_type: file.type, data: await toBase64(file) };
}

export function unknownPlayers(draft: ImportDraft, roster: Player[]) {
  const names: string[] = [];
  for (const it of draft.items)
    for (const g of it.groups)
      for (const n of g.player_names)
        if (n.trim() && !roster.some((p) => same(p.name, n)) && !names.some((x) => same(x, n))) names.push(n.trim());
  return names;
}

/**
 * Turns a reviewed draft into real practice items. Adds the accepted new categories and,
 * if chosen, the players the roster does not have yet. Returns the roster as it is afterwards.
 */
export async function resolveDraft(draft: ImportDraft, team: Team, choices: DraftChoices): Promise<{ items: Item[]; roster: Player[]; drills: Drill[] }> {
  const tags: Tag[] = (await api.bootstrap()).tags.filter((t) => t.sport_id === team.sport_id);
  for (const nt of draft.new_tags) {
    if (!choices.acceptTags.has(nt.name) || tags.some((t) => same(t.name, nt.name))) continue;
    tags.push(await api.createTag({ sport_id: team.sport_id, name: nt.name.trim(), color: TAG_COLORS[tags.length % TAG_COLORS.length], target_pct: null }));
  }
  const roster = [...(await api.players(team.id))];
  if (choices.addPlayers) for (const name of unknownPlayers(draft, roster)) roster.push(await api.createPlayer(team.id, { name }));

  // Drill library: link items to drills that already exist, and add the new ones the coach kept ticked.
  const drills = [...(await api.drills())];
  const tagIdsOf = (names: string[]) => names.map((n) => tags.find((t) => same(t.name, n))?.id).filter((x): x is number => x != null);
  for (const title of newDrillTitles(draft, drills, team.sport_id)) {
    if ([...choices.skipDrills].some((s) => same(s, title))) continue;
    const it = draft.items.find((i) => i.kind === 'item' && same(i.title, title))!;
    drills.push(
      await api.createDrill({
        sport_id: team.sport_id,
        name: title,
        duration_min: it.duration_min,
        notes_html: it.notes_html,
        callout: it.callout,
        // The library keeps the station layout, never who was in which group that day.
        groups: it.groups.map((g) => ({ name: g.name, notes_html: g.notes_html, members: [] })),
        tag_ids: tagIdsOf(it.tags),
      }),
    );
  }
  const drillIdOf = (title: string) => drills.find((d) => d.sport_id === team.sport_id && same(d.name, title))?.id ?? null;

  const items: Item[] = draft.items.map((it) => ({
    ...blankItem(newKey(), it.kind),
    drill_id: it.kind === 'item' && it.title.trim() ? drillIdOf(it.title) : null,
    title: it.title,
    duration_min: it.duration_min,
    notes_html: it.notes_html,
    callout: it.callout,
    tag_ids: tagIdsOf(it.tags),
    groups: it.groups.map((g) => ({
      name: g.name,
      notes_html: g.notes_html,
      members: g.player_names
        .map((n) => roster.find((p) => same(p.name, n)))
        .filter((p): p is Player => !!p)
        .map((p) => ({ player_id: p.id, role: '' })),
    })),
  }));
  return { items, roster, drills };
}

export function useAiStatus() {
  const [status, setStatus] = useState<AiStatus | null>(null);
  useEffect(() => {
    api.aiStatus().then(setStatus).catch(() => setStatus({ available: false, version: '' }));
  }, []);
  return status;
}

/** Where a plan comes from: a dropped file, pasted text, or a reply pasted back from claude.ai. */
export function SourcePicker(props: {
  teamId: number;
  status: AiStatus | null;
  multiple?: boolean;
  /** A file or text for Claude Code on this computer to analyze. */
  onSource: (name: string, source: ImportSource) => void;
  /** A finished draft pasted back from claude.ai. */
  onDraft: (name: string, draft: ImportDraft) => void;
}) {
  const { teamId, status } = props;
  const [dragging, setDragging] = useState(false);
  const [pasted, setPasted] = useState('');
  const [reply, setReply] = useState('');
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState('');
  const fileInput = useRef<HTMLInputElement>(null);
  if (!status) return <p className="muted">Checking for Claude on this computer…</p>;

  const addFiles = async (files: FileList | null) => {
    setError('');
    const list = Array.from(files || []);
    for (const f of props.multiple ? list : list.slice(0, 1)) {
      try {
        props.onSource(f.name, await prepareFile(f));
      } catch (e) {
        setError((e as Error).message);
      }
    }
    if (fileInput.current) fileInput.current.value = '';
  };
  const copyPrompt = async () => {
    try {
      const { prompt } = await api.aiPrompt(teamId);
      await navigator.clipboard.writeText(prompt);
      setCopied(true);
      setError('');
    } catch (e) {
      setError(`Could not copy the prompt: ${(e as Error).message}`);
    }
  };
  const loadReply = async () => {
    try {
      props.onDraft('Draft from claude.ai', await api.parseDraft(reply));
      setReply('');
      setError('');
    } catch (e) {
      setError((e as Error).message);
    }
  };

  return (
    <div className="source-picker">
      {error && <p className="error">{error}</p>}
      {status.available ? (
        <>
          <div
            className={`dropzone ${dragging ? 'over' : ''}`}
            onDragOver={(e) => {
              e.preventDefault();
              setDragging(true);
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDragging(false);
              addFiles(e.dataTransfer.files);
            }}
          >
            <p>
              <strong>Drop {props.multiple ? 'files' : 'a file'} here</strong>
              {props.multiple ? ', one practice per file.' : '.'}
            </p>
            <p className="muted small">Photos and screenshots, PDF, Word (.docx) or text files.</p>
            <input
              ref={fileInput}
              type="file"
              multiple={props.multiple}
              hidden
              accept="image/*,.pdf,.docx,.txt,.md,.csv,.html"
              onChange={(e) => addFiles(e.target.files)}
            />
            <button className="btn primary" onClick={() => fileInput.current?.click()}>
              Choose {props.multiple ? 'files' : 'a file'}
            </button>
          </div>
          <details className="paste">
            <summary>Or paste a plan as text</summary>
            <textarea className="input" rows={6} aria-label="Plan text" placeholder="Paste one practice plan here" value={pasted} onChange={(e) => setPasted(e.target.value)} />
            <button
              className="btn"
              disabled={!pasted.trim()}
              onClick={() => {
                props.onSource('Pasted plan', { text: pasted });
                setPasted('');
              }}
            >
              Analyze pasted plan
            </button>
          </details>
          <p className="muted small">
            Plans are read by Claude Code on this computer, using your normal Claude sign-in. No API key is needed.
          </p>
        </>
      ) : (
        <p className="banner">
          Claude Code was not found on this computer, so plans cannot be read automatically. Use claude.ai with the steps below.
        </p>
      )}

      <details className="paste" open={!status.available}>
        <summary>{status.available ? 'Or use claude.ai yourself' : 'Import with claude.ai'}</summary>
        <ol className="steps">
          <li>
            <button className="btn small" onClick={copyPrompt}>
              Copy the prompt
            </button>{' '}
            {copied && <span className="muted small">Copied.</span>}
          </li>
          <li>
            Open{' '}
            <a href="https://claude.ai/new" target="_blank" rel="noreferrer">
              claude.ai
            </a>
            , paste the prompt, attach your practice plan, and send.
          </li>
          <li>
            Copy Claude's whole reply and paste it here:
            <textarea className="input" rows={5} aria-label="Reply from Claude" placeholder='Starts with {"title": ...' value={reply} onChange={(e) => setReply(e.target.value)} />
            <button className="btn" disabled={!reply.trim()} onClick={loadReply}>
              Load draft
            </button>
          </li>
        </ol>
      </details>
    </div>
  );
}

/** Shows a draft for review: what Claude found, what it was unsure of, and what it suggests adding. */
export function DraftReview(props: {
  draft: ImportDraft;
  choices: DraftChoices;
  tags: Tag[];
  players: Player[];
  /** The drill library, to work out which items are new to it. */
  drills: Drill[];
  sportId: number;
  /** Title, date, start time and location. Hidden when importing into a practice that already has them. */
  showFields?: boolean;
  onDraft: (d: ImportDraft) => void;
  onChoices: (c: DraftChoices) => void;
  children?: ReactNode;
}) {
  const { draft, choices, tags, players } = props;
  const setDraft = (p: Partial<ImportDraft>) => props.onDraft({ ...draft, ...p });
  const slots = schedule(draft.start_time || '17:30', draft.items);
  const unknown = unknownPlayers(draft, players);
  const newDrills = newDrillTitles(draft, props.drills, props.sportId);
  const tagState = (name: string): 'existing' | 'new' | 'dropped' => {
    if (tags.some((t) => same(t.name, name))) return 'existing';
    return [...choices.acceptTags].some((n) => same(n, name)) ? 'new' : 'dropped';
  };

  return (
    <>
      {props.showFields && (
        <>
          <div className="fields">
            <Field label="Title" grow>
              <input className="input" value={draft.title} onChange={(e) => setDraft({ title: e.target.value })} />
            </Field>
            <Field label="Date">
              <input className="input" type="date" value={draft.date} onChange={(e) => setDraft({ date: e.target.value })} />
            </Field>
            <Field label="Start time">
              <input className="input" type="time" value={draft.start_time} onChange={(e) => setDraft({ start_time: e.target.value })} />
            </Field>
            <Field label="Location" grow>
              <input className="input" value={draft.location} onChange={(e) => setDraft({ location: e.target.value })} />
            </Field>
          </div>
          {!draft.date && <p className="muted small">The plan had no date. It will be saved with today's date unless you set one.</p>}
        </>
      )}

      {draft.warnings.length > 0 && (
        <div className="banner warn">
          <strong>Check these:</strong>
          <ul>
            {draft.warnings.map((w, i) => (
              <li key={i}>{w}</li>
            ))}
          </ul>
        </div>
      )}

      {draft.new_tags.length > 0 && (
        <section className="suggest">
          <h4>
            Suggested new categories <span className="hint">Themes in this plan that none of your categories cover.</span>
          </h4>
          {draft.new_tags.map((t) => {
            const exists = tags.some((x) => same(x.name, t.name));
            return (
              <label key={t.name} className="check suggestion">
                <input
                  type="checkbox"
                  disabled={exists}
                  checked={exists || choices.acceptTags.has(t.name)}
                  onChange={(e) => {
                    const next = new Set(choices.acceptTags);
                    if (e.target.checked) next.add(t.name);
                    else next.delete(t.name);
                    props.onChoices({ ...choices, acceptTags: next });
                  }}
                />
                <span>
                  <strong>{t.name}</strong> {exists && <span className="muted">(already added)</span>}
                  <br />
                  <span className="muted small">{t.reason}</span>
                </span>
              </label>
            );
          })}
        </section>
      )}

      {unknown.length > 0 && (
        <label className="check suggestion">
          <input type="checkbox" checked={choices.addPlayers} onChange={(e) => props.onChoices({ ...choices, addPlayers: e.target.checked })} />
          <span>
            <strong>
              Add {unknown.length} player{unknown.length === 1 ? '' : 's'} to the roster
            </strong>
            <br />
            <span className="muted small">Not on the roster: {unknown.join(', ')}. If you leave this off, they are left out of the groups.</span>
          </span>
        </label>
      )}

      {newDrills.length > 0 && (
        <section className="suggest">
          <h4>
            Add to your drill library? <span className="hint">These items are not in your library yet. Ticked ones are saved there for reuse.</span>
          </h4>
          {newDrills.map((title) => {
            const skipped = choices.skipDrills.has(title);
            return (
              <label key={title} className="check suggestion">
                <input
                  type="checkbox"
                  checked={!skipped}
                  onChange={(e) => {
                    const next = new Set(choices.skipDrills);
                    if (e.target.checked) next.delete(title);
                    else next.add(title);
                    props.onChoices({ ...choices, skipDrills: next });
                  }}
                />
                <span>
                  <strong>{title}</strong>
                </span>
              </label>
            );
          })}
          {newDrills.length > 1 && (
            <button
              type="button"
              className="link small"
              onClick={() => props.onChoices({ ...choices, skipDrills: choices.skipDrills.size ? new Set() : new Set(newDrills) })}
            >
              {choices.skipDrills.size ? 'Tick all' : 'Untick all'}
            </button>
          )}
        </section>
      )}

      <ol className="draft-items">
        {draft.items.map((it, i) => (
          <li key={i} className={it.kind}>
            <div className="draft-head">
              <span className="time">{slotLabel(slots[i])}</span>
              <strong>{it.title || (it.kind === 'break' ? 'Break' : 'Untitled')}</strong>
              <span className="muted small">{it.duration_min} min</span>
              <span className="chips">
                {it.tags.map((n) => {
                  const state = tagState(n);
                  const tag = tags.find((t) => same(t.name, n));
                  return (
                    <span key={n} className={`chip ${state}`}>
                      {tag && <span className="dot" style={{ background: tag.color }} />}
                      {n}
                      {state === 'new' && <span className="chip-num">new</span>}
                    </span>
                  );
                })}
              </span>
            </div>
            {!isBlankHtml(it.notes_html) && <div className="draft-notes sheet-notes" dangerouslySetInnerHTML={clean(it.notes_html)} />}
            {it.groups.length > 0 && (
              <div className="draft-groups">
                {it.groups.map((g, j) => (
                  <div key={j} className="draft-group">
                    {g.name && <strong>{g.name}</strong>}
                    {!isBlankHtml(g.notes_html) && <div className="sheet-notes" dangerouslySetInnerHTML={clean(g.notes_html)} />}
                    {g.player_names.length > 0 && <div>{g.player_names.join(', ')}</div>}
                  </div>
                ))}
              </div>
            )}
          </li>
        ))}
      </ol>
      {props.children}
    </>
  );
}
