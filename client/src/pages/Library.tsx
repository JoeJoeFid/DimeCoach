import { DrillBrowser } from '../components/Browsers';
import PageTitle from '../components/PageTitle';
import { CommunityPicker } from '../components/community';
import { ShareItemDialog, SharedWithBox } from '../components/ShareItem';
import { useCallback, useEffect, useState } from 'react';
import { api } from '../api';
import { useApp } from '../App';
import type { Drill, ItemContent, Play } from '../types';
import ItemBody from '../components/ItemBody';
import DrillImport from '../components/DrillImport';
import { Field, Modal, MoreMenu } from '../components/bits';
import { confirmDialog } from '../components/dialogs';
import { deleteLater, usePendingDeletes } from '../components/toasts';
import { roomyScreen } from '../util';
import SportIcon from '../components/SportIcon';

type Draft = ItemContent & { id?: number };
const resourceLabel = (n: number) => (n > 0 ? `${n} resource${n === 1 ? '' : 's'}` : '');
const blank = (): Draft => ({ title: '', duration_min: 10, notes_html: '', coach_notes_html: '', callout: '', groups: [], images: [], play_ids: [], links: [], videos: [], tag_ids: [] });
const toDraft = (d: Drill): Draft => ({ ...blank(), ...d, images: d.images || [], play_ids: d.play_ids || [], links: d.links || [], videos: d.videos || [], title: d.name });

export default function Library() {
  const { sport, sportTags } = useApp();
  const [drills, setDrills] = useState<Drill[] | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
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
  // Each drill as the shared list wants it: its categories by name and color, and what it carries in a few words.
  const items = (drills || [])
    .filter((d) => !gone.has(`drill:${d.id}`))
    .map((d) => {
      const plays = (d.play_ids || []).length;
      return {
        src: d,
        id: d.id,
        name: d.name,
        duration_min: d.duration_min,
        notes_html: d.notes_html,
        tags: sportTags.filter((t) => d.tag_ids.includes(t.id)).map((t) => ({ name: t.name, color: t.color })),
        meta: [resourceLabel((d.images || []).length + (d.videos || []).length + (d.links || []).length), plays > 0 && `${plays} play${plays === 1 ? '' : 's'}`].filter(Boolean).join(' · '),
      };
    });

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
          {/* The button starts a drill from nothing. The arrow beside it holds the other ways to get one. */}
          <div className="split-btn">
            <button className="btn primary" onClick={() => setDraft(blank())}>
              + New drill
            </button>
            <MoreMenu
              caret
              label="More ways to add a drill"
              items={[
                { label: 'Import drills', onSelect: () => setImporting(true) },
                { label: 'From a community', onSelect: () => setFromCommunity(true) },
              ]}
            />
          </div>
        </div>
      </div>
      {error && !draft && <p className="error">{error}</p>}
      {notice && <p className="banner ok">{notice}</p>}

      {/* The same list the team's parents, family and friends see the drills shared with them in. Here a drill opens to be changed, and can be shared and deleted. */}
      <DrillBrowser
        drills={drills === null ? null : items}
        compactKey="practiceplan.drillsCompact"
        categories={sportTags.map((t) => ({ name: t.name, color: t.color }))}
        onOpen={(x) => setDraft(toDraft(x.src))}
        onShare={(x) => setSharing(x.src)}
        onRemove={(x) => remove(x.src)}
        empty={
          <div className="empty">
            <h2>No drills yet</h2>
            <p>Create a drill here, or use "Save to drill library" on any practice item.</p>
          </div>
        }
      />

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
