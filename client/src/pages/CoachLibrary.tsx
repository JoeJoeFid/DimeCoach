import PageTitle from '../components/PageTitle';
import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api, type CoachLibrary, type CommunityShareDetail, type LibraryItem, type LibraryPack, type ShareKind } from '../api';
import { useApp } from '../App';
import { Modal } from '../components/bits';
import { KIND_WORDS, SharedPreview } from '../components/community';
import { confirmDialog, promptDialog } from '../components/dialogs';
import { fmtDateShort, todayISO } from '../util';

const KIND_LABEL: Record<ShareKind, string> = { drill: 'Drill', play: 'Play', plan: 'Practice' };
type Show = 'all' | ShareKind;
const SHOWS: { id: Show; label: string }[] = [
  { id: 'all', label: 'Everything' },
  { id: 'drill', label: 'Drills' },
  { id: 'play', label: 'Plays' },
  { id: 'plan', label: 'Practices' },
];
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/**
 * Drills, plays and practice plans picked out for every coach. Anyone can search it and take
 * their own copy. The system administrator publishes to it from their own account, and groups
 * what is published into packs.
 */
export default function CoachLibraryPage() {
  const { sport, team } = useApp();
  const navigate = useNavigate();
  const [lib, setLib] = useState<CoachLibrary | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [show, setShow] = useState<Show>('all');
  const [sportName, setSportName] = useState<string | null>(null);
  const [q, setQ] = useState('');
  const [busy, setBusy] = useState('');
  const [openPack, setOpenPack] = useState<number | null>(null);
  const [editing, setEditing] = useState<LibraryPack | 'new' | null>(null);

  useEffect(() => {
    api.coachLibrary().then(setLib, (e) => setError((e as Error).message));
  }, []);

  const sports = useMemo(() => [...new Set([...(lib?.items ?? []).map((i) => i.sport), ...(lib?.packs ?? []).map((p) => p.sport)].filter(Boolean))].sort(), [lib]);
  // Starts on the sport of the team being worked on, when the library has anything for it.
  const chosen = sportName ?? (sport && sports.some((s) => s.toLowerCase() === sport.name.toLowerCase()) ? sports.find((s) => s.toLowerCase() === sport.name.toLowerCase())! : 'all');
  const words = q.trim().toLowerCase();
  const matches = (text: string) => !words || text.toLowerCase().includes(words);
  const byId = useMemo(() => new Map((lib?.items ?? []).map((i) => [i.id, i])), [lib]);
  const items = (lib?.items ?? []).filter(
    (i) => (show === 'all' || i.kind === show) && (chosen === 'all' || i.sport === chosen) && matches(`${i.title} ${i.description} ${i.summary} ${i.tags.map((t) => t.name).join(' ')}`),
  );
  const packs = (lib?.packs ?? []).filter(
    (p) =>
      (chosen === 'all' || !p.sport || p.sport === chosen) &&
      (show === 'all' || p.item_ids.some((id) => byId.get(id)?.kind === show)) &&
      matches(`${p.name} ${p.description} ${p.item_ids.map((id) => byId.get(id)?.title ?? '').join(' ')}`),
  );

  /** Runs something that answers with the whole library again, and shows the result. */
  const act = async (fn: () => Promise<CoachLibrary>, done = '') => {
    try {
      setLib(await fn());
      setError('');
      setNotice(done);
    } catch (e) {
      setNotice('');
      setError((e as Error).message);
    }
  };
  const add = async (i: LibraryItem) => {
    setBusy(`item-${i.id}`);
    try {
      const made = await api.copyLibraryItem(i.id, i.kind === 'plan' ? { team_id: team?.id, date: todayISO() } : { sport_id: sport?.id });
      setError('');
      if (i.kind === 'plan') navigate(`/plans/${made.id}`);
      else if (i.kind === 'play') navigate(`/plays/${made.id}`);
      else setNotice(`"${i.title}" was added to your drills.`);
    } catch (e) {
      setNotice('');
      setError((e as Error).message);
    }
    setBusy('');
  };
  const addPack = async (p: LibraryPack) => {
    setBusy(`pack-${p.id}`);
    try {
      const n = await api.copyLibraryPack(p.id, { sport_id: sport?.id });
      const got = [n.drills > 0 && plural(n.drills, 'drill'), n.plays > 0 && plural(n.plays, 'play')].filter(Boolean).join(' and ');
      setError('');
      setNotice(
        `${got ? `${got} from "${p.name}" ${n.drills + n.plays === 1 ? 'was' : 'were'} added to your account.` : `Nothing in "${p.name}" could be added at once.`}${
          n.plans_left > 0 ? ` Its ${plural(n.plans_left, 'practice')} can be added one at a time, so each lands on the day you choose.` : ''
        }`,
      );
    } catch (e) {
      setNotice('');
      setError((e as Error).message);
    }
    setBusy('');
  };
  const describe = async (i: LibraryItem) => {
    const text = await promptDialog({ title: `Describe "${i.title}"`, body: 'A line or two that coaches see in the library: what it is for, and who it suits.', initial: i.description, confirmLabel: 'Save' });
    if (text !== null) act(() => api.describeLibraryItem(i.id, text));
  };
  const unpublish = async (i: LibraryItem) => {
    const ok = await confirmDialog({
      title: `Take "${i.title}" out of the library?`,
      body: 'Coaches will no longer find it here. Copies they already took are theirs and stay as they are, and so does your original.',
      confirmLabel: 'Take it out',
      danger: true,
    });
    if (ok) act(() => api.unpublishLibraryItem(i.id), `"${i.title}" is no longer in the library.`);
  };
  const deletePack = async (p: LibraryPack) => {
    const ok = await confirmDialog({ title: `Delete the pack "${p.name}"?`, body: 'Only the pack goes. Everything in it stays in the library.', confirmLabel: 'Delete the pack', danger: true });
    if (ok) act(() => api.deleteLibraryPack(p.id));
  };

  const row = (i: LibraryItem) => (
    <ItemRow
      key={i.id}
      item={i}
      actions={
        <>
          <button type="button" className="btn small primary" disabled={busy !== ''} onClick={() => add(i)}>
            {busy === `item-${i.id}` ? 'Adding…' : 'Add to mine'}
          </button>
          {lib?.can_manage && (
            <>
              <button type="button" className="btn small" onClick={() => describe(i)}>
                Describe
              </button>
              <button type="button" className="btn small danger" onClick={() => unpublish(i)}>
                Remove
              </button>
            </>
          )}
        </>
      }
    />
  );

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <PageTitle>Coach library</PageTitle>
          <p className="muted">Drills, plays and practices picked out for every coach. Take a copy of anything here and make it your own.</p>
        </div>
        {lib?.can_manage && (
          <div className="head-actions">
            <button className="btn primary" onClick={() => setEditing('new')}>
              New pack
            </button>
          </div>
        )}
      </div>
      {error && <p className="error">{error}</p>}
      {notice && <p className="banner ok">{notice}</p>}
      {lib?.can_manage && (
        <p className="banner">
          You run this library. To publish something, open one of your own <Link to="/library">drills</Link>, <Link to="/playbook">plays</Link> or{' '}
          <Link to="/practices">practices</Link>, choose Share, and tick "Coach library". What coaches get is a copy as it was when you published it.
        </p>
      )}
      {lib === null ? (
        !error && <p className="muted">Loading…</p>
      ) : lib.items.length === 0 && lib.packs.length === 0 ? (
        <div className="empty">
          <h2>Nothing here yet</h2>
          <p>When drills, plays and practices are published for everyone, this is where you will find them.</p>
        </div>
      ) : (
        <>
          <div className="lib-filters">
            <input className="input grow" type="search" placeholder="Search the library" aria-label="Search the library" value={q} onChange={(e) => setQ(e.target.value)} />
            {sports.length > 1 && (
              <select className="input" aria-label="Sport" value={chosen} onChange={(e) => setSportName(e.target.value)}>
                <option value="all">All sports</option>
                {sports.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            )}
            <div className="seg" role="group" aria-label="Kind">
              {SHOWS.map((s) => (
                <button key={s.id} type="button" className={show === s.id ? 'on' : ''} aria-pressed={show === s.id} onClick={() => setShow(s.id)}>
                  {s.label}
                </button>
              ))}
            </div>
          </div>

          {packs.length > 0 && (
            <section className="lib-packs" aria-label="Packs">
              <h2>Packs</h2>
              <ul>
                {packs.map((p) => {
                  const inside = p.item_ids.map((id) => byId.get(id)).filter((i): i is LibraryItem => !!i);
                  const counts = (['drill', 'play', 'plan'] as ShareKind[])
                    .map((k) => [k, inside.filter((i) => i.kind === k).length] as const)
                    .filter(([, n]) => n > 0)
                    .map(([k, n]) => plural(n, KIND_LABEL[k].toLowerCase()))
                    .join(' · ');
                  const open = openPack === p.id;
                  return (
                    <li key={p.id} className={`card lib-pack ${open ? 'open' : ''}`}>
                      <div className="lib-pack-head">
                        <div>
                          <h3>{p.name}</h3>
                          <p className="muted small">{[p.sport, counts || 'Empty'].filter(Boolean).join(' · ')}</p>
                          {p.description && <p className="lib-desc">{p.description}</p>}
                        </div>
                        <span className="row-actions">
                          <button type="button" className="btn small" aria-expanded={open} onClick={() => setOpenPack(open ? null : p.id)}>
                            {open ? 'Hide' : 'See what is in it'}
                          </button>
                          <button type="button" className="btn small primary" disabled={busy !== '' || inside.length === 0} onClick={() => addPack(p)}>
                            {busy === `pack-${p.id}` ? 'Adding…' : 'Add all to mine'}
                          </button>
                          {lib.can_manage && (
                            <>
                              <button type="button" className="btn small" onClick={() => setEditing(p)}>
                                Edit
                              </button>
                              <button type="button" className="btn small danger" onClick={() => deletePack(p)}>
                                Delete
                              </button>
                            </>
                          )}
                        </span>
                      </div>
                      {open && (inside.length === 0 ? <p className="muted small">Nothing has been put in this pack yet.</p> : <ul className="share-list">{inside.map(row)}</ul>)}
                    </li>
                  );
                })}
              </ul>
            </section>
          )}

          <section className="card" aria-label="Everything in the library">
            <div className="card-head">
              <h2>
                {show === 'all' ? 'Everything' : SHOWS.find((s) => s.id === show)!.label} <span className="muted">({items.length})</span>
              </h2>
            </div>
            {items.length === 0 ? <p className="muted">{words ? 'Nothing matches that search.' : 'Nothing of this kind has been published yet.'}</p> : <ul className="share-list">{items.map(row)}</ul>}
            <p className="muted small">
              Adding makes your own copy, which you can change freely. Drills and plays go to the sport of the team you are working on{sport ? ` (${sport.name})` : ''}, and a practice
              is added to {team ? team.name : 'your team'} for today.
            </p>
          </section>
        </>
      )}
      {editing && lib && (
        <PackEditor
          pack={editing === 'new' ? null : editing}
          items={lib.items}
          sports={sports}
          onClose={() => setEditing(null)}
          onSave={async (b) => {
            await act(() => (editing === 'new' ? api.createLibraryPack(b) : api.updateLibraryPack(editing.id, b)), `The pack "${b.name}" was saved.`);
            setEditing(null);
          }}
        />
      )}
    </div>
  );
}

/** One published thing: what it is, a look inside, and whatever actions the caller passes. */
function ItemRow({ item, actions }: { item: LibraryItem; actions: React.ReactNode }) {
  const [detail, setDetail] = useState<Pick<CommunityShareDetail, 'kind' | 'content'> | null>(null);
  const [open, setOpen] = useState(false);
  const [error, setError] = useState('');
  const toggle = async () => {
    setOpen(!open);
    if (!open && !detail) {
      try {
        setDetail(await api.coachLibraryItem(item.id));
      } catch (e) {
        setError((e as Error).message);
      }
    }
  };
  return (
    <li className="share-row">
      <div className="share-head">
        <button type="button" className="share-main" onClick={toggle} aria-expanded={open}>
          <span className="share-title">
            {item.title}
            <span className="kind">{KIND_LABEL[item.kind]}</span>
          </span>
          <span className="muted small">
            {[item.sport, item.summary, item.adds !== undefined ? `added ${plural(item.adds, 'time')}` : '', item.adds !== undefined ? `published ${fmtDateShort(item.published_at.slice(0, 10))}` : '']
              .filter(Boolean)
              .join(' · ')}
          </span>
          {item.description && <span className="lib-desc">{item.description}</span>}
          {item.tags.length > 0 && (
            <span className="chips">
              {item.tags.map((t) => (
                <span key={t.name} className="chip">
                  <span className="dot" style={{ background: t.color }} />
                  {t.name}
                </span>
              ))}
            </span>
          )}
        </button>
        <span className="row-actions">
          <button type="button" className="btn small" onClick={toggle}>
            {open ? 'Hide' : 'Preview'}
          </button>
          {actions}
        </span>
      </div>
      {open && (error ? <p className="error">{error}</p> : detail ? <SharedPreview detail={detail} /> : <p className="muted small">Loading…</p>)}
    </li>
  );
}

/** Name a pack, say what it is for, and tick what goes in it. */
function PackEditor({
  pack,
  items,
  sports,
  onClose,
  onSave,
}: {
  pack: LibraryPack | null;
  items: LibraryItem[];
  sports: string[];
  onClose: () => void;
  onSave: (b: { name: string; description: string; sport: string; item_ids: number[] }) => Promise<void>;
}) {
  const [name, setName] = useState(pack?.name ?? '');
  const [description, setDescription] = useState(pack?.description ?? '');
  const [sport, setSport] = useState(pack?.sport ?? (sports.length === 1 ? sports[0] : ''));
  const [picked, setPicked] = useState<number[]>(pack?.item_ids ?? []);
  const [saving, setSaving] = useState(false);
  const offered = items.filter((i) => !sport || i.sport === sport || picked.includes(i.id));
  const flip = (id: number) => setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]));
  return (
    <Modal title={pack ? `Edit "${pack.name}"` : 'New pack'} onClose={onClose} wide>
      <label className="field">
        <span className="field-label">Name</span>
        <input className="input" value={name} maxLength={80} autoFocus onChange={(e) => setName(e.target.value)} placeholder="Youth starter pack" />
      </label>
      <label className="field">
        <span className="field-label">What it is for</span>
        <textarea className="input" rows={2} maxLength={600} value={description} onChange={(e) => setDescription(e.target.value)} />
      </label>
      <label className="field">
        <span className="field-label">Sport</span>
        <select className="input" value={sport} onChange={(e) => setSport(e.target.value)}>
          <option value="">Any sport</option>
          {sports.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
      </label>
      <span className="field-label">In this pack ({picked.length})</span>
      {offered.length === 0 ? (
        <p className="muted small">Nothing has been published{sport ? ` for ${sport}` : ''} yet. Publish drills, plays or practices first, then put them in a pack.</p>
      ) : (
        <ul className="share-choices lib-pick">
          {offered.map((i) => (
            <li key={i.id}>
              <label className="check">
                <input type="checkbox" checked={picked.includes(i.id)} onChange={() => flip(i.id)} />
                <span>
                  <strong>{i.title}</strong>
                  <span className="muted small"> · {[KIND_WORDS[i.kind].one, i.sport, i.summary].filter(Boolean).join(' · ')}</span>
                </span>
              </label>
            </li>
          ))}
        </ul>
      )}
      <div className="modal-actions">
        <button className="btn" onClick={onClose}>
          Cancel
        </button>
        <button
          className="btn primary"
          disabled={!name.trim() || saving}
          onClick={async () => {
            setSaving(true);
            await onSave({ name: name.trim(), description: description.trim(), sport, item_ids: picked });
            setSaving(false);
          }}
        >
          {saving ? 'Saving…' : 'Save the pack'}
        </button>
      </div>
    </Modal>
  );
}
