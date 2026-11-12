import { CommunityPicker, ShareDialog } from '../components/community';
import { useCallback, useEffect, useState } from 'react';
import { api } from '../api';
import { useApp } from '../App';
import type { Drill, ItemContent, Play } from '../types';
import ItemBody from '../components/ItemBody';
import { Field, Modal, TagChip } from '../components/bits';
import { confirmDialog } from '../components/dialogs';
import { htmlPreview } from '../util';

type Draft = ItemContent & { id?: number };
const resourceLabel = (n: number) => (n > 0 ? `${n} resource${n === 1 ? '' : 's'}` : '');
const blank = (): Draft => ({ title: '', duration_min: 10, notes_html: '', coach_notes_html: '', callout: '', groups: [], images: [], play_ids: [], links: [], videos: [], tag_ids: [] });
const toDraft = (d: Drill): Draft => ({ ...blank(), ...d, images: d.images || [], play_ids: d.play_ids || [], links: d.links || [], videos: d.videos || [], title: d.name });

export default function Library() {
  const { sport, sportTags } = useApp();
  const [drills, setDrills] = useState<Drill[] | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [q, setQ] = useState('');
  const [tagId, setTagId] = useState(0);
  const [error, setError] = useState('');
  const [fromCommunity, setFromCommunity] = useState(false);
  const [sharing, setSharing] = useState<Drill | null>(null);
  const [plays, setPlays] = useState<Play[]>([]);
  useEffect(() => {
    api.plays().then(setPlays).catch(() => {});
  }, []);

  const load = useCallback(async () => {
    try {
      setDrills((await api.drills()).filter((d) => d.sport_id === sport?.id));
    } catch (e) {
      setError((e as Error).message);
    }
  }, [sport?.id]);
  useEffect(() => {
    load();
  }, [load]);

  const save = async () => {
    if (!draft || !sport) return;
    if (!draft.title.trim()) return setError('Give the drill a name.');
    const body = { ...draft, name: draft.title.trim(), sport_id: sport.id };
    try {
      if (draft.id) await api.updateDrill(body as Drill);
      else await api.createDrill(body);
      setDraft(null);
      setError('');
      await load();
    } catch (e) {
      setError((e as Error).message);
    }
  };
  const remove = async (d: Drill) => {
    if (!(await confirmDialog({ title: `Delete "${d.name}" from the library?`, body: 'Practices that already use it keep their copy.', confirmLabel: 'Delete drill', danger: true }))) return;
    await api.deleteDrill(d.id);
    await load();
  };

  const shown = (drills || []).filter(
    (d) => d.name.toLowerCase().includes(q.toLowerCase()) && (tagId === 0 || d.tag_ids.includes(tagId)),
  );

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>Drills</h1>
          <p className="muted">
            Reusable {sport?.name.toLowerCase()} items. Adding one to a practice makes a copy, so editing a drill here never changes past
            practices.
          </p>
        </div>
        <div className="head-actions">
          <button className="btn" onClick={() => setFromCommunity(true)}>
            From a community
          </button>
          <button className="btn primary" onClick={() => setDraft(blank())}>
            + New drill
          </button>
        </div>
      </div>
      {error && !draft && <p className="error">{error}</p>}

      <div className="picker-filters">
        <input className="input grow" placeholder="Search drills" value={q} onChange={(e) => setQ(e.target.value)} />
        <select className="input" aria-label="Filter by category" value={tagId} onChange={(e) => setTagId(Number(e.target.value))}>
          <option value={0}>All categories</option>
          {sportTags.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </select>
      </div>

      {drills === null ? (
        <p className="muted">Loading…</p>
      ) : shown.length === 0 ? (
        <div className="empty">
          <h2>{drills.length === 0 ? 'No drills yet' : 'No drills match'}</h2>
          <p>Create a drill here, or use "Save to drill library" on any practice item.</p>
        </div>
      ) : (
        <ul className="drill-cards">
          {shown.map((d) => {
            const preview = htmlPreview(d.notes_html);
            const plays = (d.play_ids || []).length;
            return (
              <li key={d.id} className="drill-card">
                <button className="drill-card-main" onClick={() => setDraft(toDraft(d))}>
                  <span className="drill-card-top">
                    <span className="drill-card-name">{d.name}</span>
                    <span className="drill-card-time">{d.duration_min} min</span>
                  </span>
                  <span className="chips">
                    {sportTags
                      .filter((t) => d.tag_ids.includes(t.id))
                      .map((t) => (
                        <TagChip key={t.id} tag={t} />
                      ))}
                  </span>
                  {preview && <span className="drill-card-notes">{preview}</span>}
                  <span className="plan-meta">
                    {[resourceLabel((d.images || []).length + (d.videos || []).length + (d.links || []).length), plays > 0 && `${plays} play${plays === 1 ? '' : 's'}`]
                      .filter(Boolean)
                      .join(' · ')}
                  </span>
                </button>
                <span className="row-actions">
                  <button className="btn small" onClick={() => setSharing(d)}>
                    Share
                  </button>
                  <button className="btn small" onClick={() => setDraft(toDraft(d))}>
                    Edit
                  </button>
                  <button className="btn small danger" onClick={() => remove(d)}>
                    Delete
                  </button>
                </span>
              </li>
            );
          })}
        </ul>
      )}

      {fromCommunity && (
        <CommunityPicker
          kind="drill"
          onClose={() => setFromCommunity(false)}
          onAdded={() => {
            setFromCommunity(false);
            load();
          }}
        />
      )}
      {sharing && <ShareDialog kind="drill" itemId={sharing.id} title={sharing.name} onClose={() => setSharing(null)} />}
      {draft && (
        <Modal title={draft.id ? 'Edit drill' : 'New drill'} onClose={() => setDraft(null)} wide>
          {error && <p className="error">{error}</p>}
          <div className="fields">
            <Field label="Name" grow>
              <input className="input" autoFocus value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })} />
            </Field>
            <Field label="Default minutes">
              <input
                className="input"
                type="number"
                min={0}
                step={5}
                value={draft.duration_min}
                onChange={(e) => setDraft({ ...draft, duration_min: Math.max(0, Math.round(Number(e.target.value) || 0)) })}
              />
            </Field>
          </div>
          <ItemBody value={draft} onChange={(patch) => setDraft((d) => (d ? { ...d, ...patch } : d))} tags={sportTags} plays={plays.filter((p) => p.sport_id === sport?.id)} />
          <div className="modal-foot">
            <button className="btn" onClick={() => setDraft(null)}>
              Cancel
            </button>
            <button className="btn primary" onClick={save}>
              Save drill
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}
