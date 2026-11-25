import PageTitle from '../components/PageTitle';
import { CommunityPicker } from '../components/community';
import { ShareItemDialog, SharedWithBox } from '../components/ShareItem';
import { useCallback, useEffect, useState } from 'react';
import { api } from '../api';
import { useApp } from '../App';
import type { Drill, ItemContent, Play } from '../types';
import ItemBody from '../components/ItemBody';
import DrillImport from '../components/DrillImport';
import { Field, Modal, TagChip, ShareIcon } from '../components/bits';
import { confirmDialog } from '../components/dialogs';
import { deleteLater, usePendingDeletes } from '../components/toasts';
import { hasTerms, htmlPreview, htmlText, roomyScreen, searchSnippet, searchTerms } from '../util';
import Hit from '../components/Hit';
import SportIcon from '../components/SportIcon';

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
  const [importing, setImporting] = useState(false);
  const [notice, setNotice] = useState('');
  const [sharing, setSharing] = useState<Drill | null>(null);
  /** Goes up each time the share box closes, so the list of where a drill is shared is read again. */
  const [shareVersion, setShareVersion] = useState(0);
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
    deleteLater({ key: `drill:${d.id}`, message: `Deleted the drill "${d.name}".`, run: () => api.deleteDrill(d.id), done: load, failed: setError });
  };

  const gone = usePendingDeletes();
  // Every word typed has to be in the drill's name or its notes.
  const terms = searchTerms(q);
  const shown = (drills || []).filter(
    (d) => !gone.has(`drill:${d.id}`) && hasTerms(`${d.name} ${htmlText(d.notes_html)}`, terms) && (tagId === 0 || d.tag_ids.includes(tagId)),
  );

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <PageTitle
            about={{
              lead: 'Your library of drills, built once and used again and again.',
              points: ['Add a drill to any practice from here or from the practice itself.', 'Adding one to a practice makes a copy, so editing a drill here never changes past practices.', 'Give a drill a diagram, links, video and categories so it is easy to find and to teach.'],
            }}
          >
            Drills
          </PageTitle>
        </div>
        <div className="head-actions">
          <button className="btn" onClick={() => setImporting(true)}>
            Import
          </button>
          <button className="btn" onClick={() => setFromCommunity(true)}>
            From a community
          </button>
          <button className="btn primary" onClick={() => setDraft(blank())}>
            + New drill
          </button>
        </div>
      </div>
      {error && !draft && <p className="error">{error}</p>}
      {notice && <p className="banner ok">{notice}</p>}

      <div className="picker-filters">
        <input className="input grow search-input" type="search" aria-label="Search drills by name or notes" placeholder="Search drills by name or notes" value={q} onChange={(e) => setQ(e.target.value)} />
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
            // While searching, the notes are shown from where a word was found in them.
            const preview = (terms.length > 0 && searchSnippet(htmlText(d.notes_html), terms)) || htmlPreview(d.notes_html);
            const plays = (d.play_ids || []).length;
            return (
              <li key={d.id} className="drill-card">
                <button className="drill-card-main" onClick={() => setDraft(toDraft(d))}>
                  <span className="drill-card-top">
                    <span className="drill-card-name">
                      <Hit text={d.name} terms={terms} />
                    </span>
                    <span className="drill-card-time">{d.duration_min} min</span>
                  </span>
                  <span className="chips">
                    {sportTags
                      .filter((t) => d.tag_ids.includes(t.id))
                      .map((t) => (
                        <TagChip key={t.id} tag={t} />
                      ))}
                  </span>
                  {preview && (
                    <span className="drill-card-notes">
                      <Hit text={preview} terms={terms} />
                    </span>
                  )}
                  <span className="plan-meta">
                    {[resourceLabel((d.images || []).length + (d.videos || []).length + (d.links || []).length), plays > 0 && `${plays} play${plays === 1 ? '' : 's'}`]
                      .filter(Boolean)
                      .join(' · ')}
                  </span>
                </button>
                {/* Clicking the drill itself opens it to edit. */}
                <span className="row-actions">
                  <button type="button" className="btn small icon-btn" aria-label={`Share ${d.name}`} title="Share" onClick={() => setSharing(d)}>
                    <ShareIcon size={17} />
                  </button>
                  <button type="button" className="btn small icon-btn danger" aria-label={`Delete ${d.name}`} title="Delete" onClick={() => remove(d)}>
                    <svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" strokeWidth="1.800" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                      <path d="M4.500 7h15M9.500 7V4.500h5V7M6.500 7l1 12.500h9l1-12.500M10 11v5M14 11v5" />
                    </svg>
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
          many
          onClose={() => setFromCommunity(false)}
          // The box stays open for more. The list behind it is brought up to date each time.
          onAdded={load}
        />
      )}
      {importing && (
        <DrillImport
          existing={drills || []}
          onClose={() => setImporting(false)}
          onDone={(n) => {
            setImporting(false);
            setNotice(`${n} drill${n === 1 ? ' was' : 's were'} added to your library.`);
            load();
          }}
        />
      )}
      {sharing && (
        <ShareItemDialog
          what={{ kind: 'drill', id: sharing.id, title: sharing.name }}
          onClose={() => {
            setSharing(null);
            setShareVersion((v) => v + 1);
          }}
        />
      )}
      {draft && (
        <Modal
          title={
            <span className="drill-modal-title">
              <SportIcon sport={sport?.name} size={24} />
              {draft.id ? 'Edit drill' : 'New drill'}
            </span>
          }
          label={draft.id ? 'Edit drill' : 'New drill'}
          onClose={() => setDraft(null)}
          wide
        >
          {error && <p className="error">{error}</p>}
          <div className="fields drill-top">
            <Field
              label={
                <>
                  Name <span className="req">*</span>
                </>
              }
              grow
            >
              <input className="input" autoFocus={roomyScreen()} required value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })} />
            </Field>
            <Field
              label={
                <>
                  Default minutes <span className="req">*</span>
                </>
              }
            >
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
          <ItemBody cards value={draft} onChange={(patch) => setDraft((d) => (d ? { ...d, ...patch } : d))} tags={sportTags} plays={plays.filter((p) => p.sport_id === sport?.id)} />
          {draft.id && <SharedWithBox what={{ kind: 'drill', id: draft.id, title: draft.title }} version={shareVersion} onShare={() => setSharing((drills || []).find((d) => d.id === draft.id) ?? null)} />}
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
