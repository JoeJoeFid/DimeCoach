import { Fragment, useCallback, useEffect, useMemo, useRef, useState, type PointerEventHandler, type ReactNode } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { DndContext, DragOverlay, KeyboardSensor, PointerSensor, closestCenter, useDraggable, useSensor, useSensors, type DragEndEvent, type DragMoveEvent } from '@dnd-kit/core';
import { SortableContext, arrayMove, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { api, newKey } from '../api';
import { useApp } from '../App';
import type { Drill, ImportDraft, Item, Plan, Play, Player, Tag, Team } from '../types';
import { blankItem, fmtClock, fmtDateShort, fmtDuration, htmlPreview, isBlankHtml, planMinutes, schedule, slotGroups, slotLabel, type Slot } from '../util';
import ItemBody from '../components/ItemBody';
import { Field, Modal, MoreMenu, TagChip, type MenuItem } from '../components/bits';
import { CommunityPicker, ShareDialog } from '../components/community';
import { confirmDialog, promptDialog } from '../components/dialogs';
import { DraftReview, SourcePicker, defaultChoices, resolveDraft, useAiStatus, type DraftChoices } from '../components/planImport';

type SaveState = 'saved' | 'dirty' | 'saving' | 'error';

// Things dragged in from the side list are not in the plan yet. Their ids say what to make:
// "new:custom", "new:break", or "new:drill:<id>".
const NEW = 'new:';
const isNew = (id: string | number) => String(id).startsWith(NEW);

export default function PlanEditor() {
  const { id } = useParams();
  const planId = Number(id);
  const navigate = useNavigate();
  const app = useApp();

  const [plan, setPlan] = useState<Plan | null>(null);
  const [players, setPlayers] = useState<Player[]>([]);
  const [drills, setDrills] = useState<Drill[]>([]);
  const [plays, setPlays] = useState<Play[]>([]);
  const [open, setOpen] = useState<Set<string>>(new Set());
  const [saveState, setSaveState] = useState<SaveState>('saved');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [pickAt, setPickAt] = useState<number | null>(null);
  /** Where the coach has started a new item but not yet said whether it is a library drill or a custom one. */
  const [choosingAt, setChoosingAt] = useState<number | null>(null);
  const [focusKey, setFocusKey] = useState('');
  /** Whether the "start from a previous practice" picker is open. */
  const [starting, setStarting] = useState(false);
  const [sharing, setSharing] = useState(false);
  /** Where a drill taken from a community library will be inserted. */
  const [communityAt, setCommunityAt] = useState<number | null>(null);
  /** What is being dragged in from the side list, and the place in the plan it would land. */
  const [incoming, setIncoming] = useState('');
  const [dropAt, setDropAt] = useState<number | null>(null);
  /** True while the place it would land is beside an item already there, sharing its time. */
  const [dropBeside, setDropBeside] = useState(false);
  const column = useRef<HTMLDivElement>(null);
  const [searchParams, setSearchParams] = useSearchParams();
  const [importing, setImporting] = useState(searchParams.has('import') && app.user.can_import);

  // --- Autosave ---------------------------------------------------------
  const latest = useRef<Plan | null>(null);
  const version = useRef(0);
  const timer = useRef<number | undefined>(undefined);

  const flush = useCallback(async () => {
    window.clearTimeout(timer.current);
    const p = latest.current;
    if (!p) return;
    const v = version.current;
    setSaveState('saving');
    try {
      await api.savePlan(p);
      if (version.current === v) setSaveState('saved');
    } catch (e) {
      setSaveState('error');
      setError(`Could not save: ${(e as Error).message}`);
    }
  }, []);

  const update = useCallback(
    (patch: Partial<Plan>) => {
      if (!latest.current) return;
      const next = { ...latest.current, ...patch };
      latest.current = next;
      version.current++;
      setPlan(next);
      setSaveState('dirty');
      window.clearTimeout(timer.current);
      timer.current = window.setTimeout(flush, 700);
    },
    [flush],
  );

  useEffect(() => {
    let alive = true;
    const dirtyAtStart = version.current;
    setPlan(null);
    (async () => {
      try {
        const p = await api.plan(planId);
        const [pl, dr, py] = await Promise.all([api.players(p.team_id), api.drills(), api.plays()]);
        if (!alive) return;
        latest.current = p;
        setPlan(p);
        setPlayers(pl);
        setDrills(dr);
        setPlays(py);
        if (p.items.length <= 1) setOpen(new Set(p.items.map((i) => i.key)));
      } catch (e) {
        if (alive) setError((e as Error).message);
      }
    })();
    return () => {
      alive = false;
      // Save anything still pending when leaving the page.
      window.clearTimeout(timer.current);
      if (latest.current && version.current !== dirtyAtStart) api.savePlan(latest.current).catch(() => {});
      latest.current = null;
    };
  }, [planId]);

  // --- Derived ----------------------------------------------------------
  const team = app.teams.find((t) => t.id === plan?.team_id);
  const tags = useMemo(() => app.tags.filter((t) => t.sport_id === team?.sport_id), [app.tags, team]);
  const tagIds = useMemo(() => new Set(tags.map((t) => t.id)), [tags]);
  const slots = useMemo(() => (plan ? schedule(plan.start_time, plan.items) : []), [plan]);
  const groups = useMemo(() => (plan ? slotGroups(plan.items) : []), [plan]);
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  if (error && !plan)
    return (
      <div className="page">
        <p className="error">{error}</p>
        <Link to="/practices">Back to practices</Link>
      </div>
    );
  if (!plan) return <div className="page muted">Loading…</div>;

  const isHomework = plan.kind === 'homework';
  const listPath = isHomework ? '/homework' : '/practices';
  const mins = planMinutes(plan, tagIds);
  const total = mins.work + mins.breaks;

  // --- Item operations --------------------------------------------------
  const setItems = (items: Item[]) => update({ items });
  const patchItem = (key: string, patch: Partial<Item>) =>
    setItems((latest.current ?? plan).items.map((it) => (it.key === key ? { ...it, ...patch } : it)));
  const insertAt = (index: number, item: Item, expand = true) => {
    const items = [...plan.items];
    items.splice(index, 0, item);
    setItems(items);
    if (expand && item.kind === 'item') setOpen((o) => new Set(o).add(item.key));
  };
  const toggle = (key: string) =>
    setOpen((o) => {
      const n = new Set(o);
      if (n.has(key)) n.delete(key);
      else n.add(key);
      return n;
    });
  const removeItem = async (it: Item) => {
    // An item someone has filled in is worth a second look. Empty items and breaks go straight away.
    const hasContent =
      it.kind === 'item' &&
      (it.title.trim() !== '' || !isBlankHtml(it.notes_html) || !isBlankHtml(it.coach_notes_html) || it.groups.length > 0 || it.images.length > 0 || it.videos.length > 0 || it.links.length > 0 || it.player_notes.length > 0);
    if (hasContent) {
      const ok = await confirmDialog({
        title: `Remove "${it.title.trim() || 'Untitled item'}" from this ${isHomework ? 'homework sheet' : 'practice'}?`,
        body: 'Its notes, pictures, groups and player notes go with it.',
        confirmLabel: 'Remove item',
        danger: true,
      });
      if (!ok) return;
    }
    const items = (latest.current ?? plan).items;
    const at = items.findIndex((x) => x.key === it.key);
    // If it led a shared time slot, the next one takes over the slot and does not join whatever is above.
    setItems(items.filter((x) => x.key !== it.key).map((x, i) => (i === at && !it.beside && x.beside ? { ...x, beside: false } : x)));
  };
  /** Puts an item in the time slot of the one above it, or gives it back a slot of its own. */
  const setBeside = (key: string, beside: boolean) => patchItem(key, { beside });
  /**
   * The place in the plan a dragged-in thing would take. Anywhere over the plan's column counts,
   * not just over an item: it lands after every item whose middle is above the pointer, so the
   * gaps between items and all the space under the last one are good places to let go.
   */
  const landing = (e: DragMoveEvent | DragEndEvent) => {
    const el = column.current;
    if (!el) return null;
    const start = e.activatorEvent as PointerEvent;
    const x = start.clientX + e.delta.x;
    const y = start.clientY + e.delta.y;
    const box = el.getBoundingClientRect();
    if (x < box.left || x > box.right) return null;
    // The "Drop here" space pushes the rows after it down. Judge by where they would be without
    // it, or the space would chase the pointer and never settle.
    const space = el.querySelector(':scope > .drop-slot:not(.idle)')?.getBoundingClientRect();
    const pushed = space ? space.height + 12 : 0;
    // Over a "same time" area at the right of a slot: it joins that slot.
    for (const zone of el.querySelectorAll<HTMLElement>('.beside-zone')) {
      const r = zone.getBoundingClientRect();
      const down = space && r.top > space.top ? pushed : 0;
      if (x >= r.left && x <= r.right && y >= r.top - down && y <= r.bottom - down) return { at: Number(zone.dataset.end), beside: true };
    }
    let at = 0;
    for (const group of el.querySelectorAll<HTMLElement>(':scope > .slot-group')) {
      const r = group.getBoundingClientRect();
      const top = space && r.top > space.top ? r.top - pushed : r.top;
      if (y > top + r.height / 2) at = Number(group.dataset.end);
    }
    return { at, beside: false };
  };
  /** Adds what a side-list id stands for. With no place given it goes at the end. */
  const addNew = (id: string, index = (latest.current ?? plan).items.length, beside = false) => {
    const what = id.slice(NEW.length);
    if (what === 'custom') return addCustom(index, beside);
    if (what === 'break') return insertAt(index, blankItem(newKey(), 'break'));
    const drill = drills.find((d) => d.id === Number(what.split(':')[1]));
    if (drill) addDrill(drill, index, beside);
  };
  const onDragEnd = (e: DragEndEvent) => {
    if (isNew(e.active.id)) {
      const spot = landing(e);
      setIncoming('');
      setDropAt(null);
      setDropBeside(false);
      if (spot) addNew(String(e.active.id), spot.at, spot.beside);
      return;
    }
    if (!e.over || e.active.id === e.over.id) return;
    const from = plan.items.findIndex((i) => i.key === e.active.id);
    const to = plan.items.findIndex((i) => i.key === e.over!.id);
    if (from < 0 || to < 0) return;
    // An item moved by its handle gets a time slot of its own where it lands. If it led a shared
    // slot, the item that was beside it takes that slot over.
    const moved = plan.items[from];
    const items = plan.items.map((it, i) => (i === from || (i === from + 1 && !moved.beside) ? { ...it, beside: false } : it));
    setItems(arrayMove(items, from, to));
  };
  const addDrill = (d: Drill, index: number, beside = false) => {
    insertAt(
      index,
      {
        ...blankItem(newKey()),
        title: d.name,
        duration_min: d.duration_min,
        notes_html: d.notes_html,
        coach_notes_html: d.coach_notes_html,
        callout: d.callout,
        groups: d.groups.map((g) => ({ ...g, members: [] })),
        images: (d.images || []).map((im) => ({ ...im })),
        play_ids: [...(d.play_ids || [])],
        links: (d.links || []).map((l) => ({ ...l })),
        videos: (d.videos || []).map((v) => ({ ...v })),
        tag_ids: [...d.tag_ids],
        drill_id: d.id,
        beside,
      },
      false,
    );
    setPickAt(null);
    setChoosingAt(null);
  };
  const saveToLibrary = async (it: Item) => {
    if (!team) return;
    try {
      const d = await api.createDrill({
        sport_id: team.sport_id,
        name: it.title || 'Untitled drill',
        duration_min: it.duration_min,
        notes_html: it.notes_html,
        coach_notes_html: it.coach_notes_html,
        callout: it.callout,
        groups: it.groups,
        images: it.images,
        play_ids: it.play_ids,
        links: it.links,
        videos: it.videos,
        tag_ids: it.tag_ids,
      });
      setDrills((ds) => [...ds, d]);
      patchItem(it.key, { drill_id: d.id });
      setNotice(`Saved "${d.name}" to the drill library.`);
    } catch (e) {
      setError((e as Error).message);
    }
  };

  // --- Plan operations --------------------------------------------------
  const saveAsTemplate = async () => {
    const name = await promptDialog({ title: 'Name this template', initial: plan.title || 'Practice template', confirmLabel: 'Save template' });
    if (!name) return;
    try {
      await flush();
      await api.createPlan({ team_id: plan.team_id, from_plan_id: plan.id, is_template: true, title: name });
      setNotice(`Saved template "${name}". Find it on the ${isHomework ? 'Homework' : 'Practices'} page.`);
    } catch (e) {
      setError((e as Error).message);
    }
  };
  const duplicate = async () => {
    try {
      await flush();
      const copy = await api.createPlan({ team_id: plan.team_id, from_plan_id: plan.id, date: plan.date });
      navigate(`/plans/${copy.id}`);
    } catch (e) {
      setError((e as Error).message);
    }
  };
  const remove = async () => {
    if (!(await confirmDialog({ title: `Delete this ${plan.is_template ? 'template' : isHomework ? 'homework sheet' : 'practice'}?`, body: 'This cannot be undone.', confirmLabel: 'Delete', danger: true }))) return;
    window.clearTimeout(timer.current);
    latest.current = null;
    await api.deletePlan(plan.id);
    navigate(listPath);
  };
  const openPrint = async () => {
    await flush();
    navigate(`/plans/${plan.id}/print`);
  };

  const addCustom = (index: number, beside = false) => {
    const item = { ...blankItem(newKey()), beside };
    insertAt(index, item);
    setFocusKey(item.key);
    setChoosingAt(null);
  };
  const libraryDrills = drills.filter((d) => d.sport_id === team?.sport_id);
  /**
   * The gap between items. "+ Item" does not add anything yet: it asks first whether the new item
   * comes from the drill library or is written from scratch.
   */
  // Less-used actions live behind the "..." button, so the header stays quiet.
  const moreItems: MenuItem[] = [
    ...(!isHomework && app.user.can_import ? [{ label: 'Import plan', onSelect: () => setImporting(true) }] : []),
    { label: 'Duplicate', onSelect: duplicate },
    ...(!plan.is_template ? [{ label: 'Share with a community', onSelect: () => setSharing(true) }] : []),
    ...(!plan.is_template ? [{ label: 'Save as template', onSelect: saveAsTemplate }] : []),
    { label: 'Delete', onSelect: remove, danger: true },
  ];
  const sheet = isHomework ? 'homework sheet' : 'practice';
  /** Fills this (empty) plan with a copy of another plan's items. The other plan is not changed. */
  const startFrom = (source: Plan) => {
    setItems(source.items.map((it) => ({ ...structuredClone(it), key: newKey() })));
    setStarting(false);
    setNotice(
      `Started from ${source.is_template ? `the template "${source.title}"` : `the ${sheet} on ${fmtDateShort(source.date)}`}. Change anything you like: the original is untouched.`,
    );
  };

  /** The space that opens up where a dragged-in thing will land. */
  const dropSlot = <div className="drop-slot">Drop here</div>;
  const inserter = (index: number) =>
    choosingAt === index ? (
      <div className="card item chooser" role="group" aria-label="New item">
        <strong>New item</strong>
        <button type="button" className="btn primary" autoFocus onClick={() => setPickAt(index)}>
          Choose a drill
          {libraryDrills.length > 0 && <span className="chip-num">{libraryDrills.length}</span>}
        </button>
        <button type="button" className="btn" onClick={() => addCustom(index)}>
          Custom item
        </button>
        <span className="muted small grow">
          A drill comes with its notes, categories and resources. A custom item starts blank.{' '}
          <button type="button" className="link" onClick={() => setCommunityAt(index)}>
            Or take one from a community
          </button>
        </span>
        <button type="button" className="btn ghost" aria-label="Cancel new item" onClick={() => setChoosingAt(null)}>
          ✕
        </button>
      </div>
    ) : (
      <div className="inserter">
        <button type="button" onClick={() => setChoosingAt(index)}>
          + Item
        </button>
        {!isHomework && (
          <button type="button" onClick={() => insertAt(index, blankItem(newKey(), 'break'))}>
            + Break
          </button>
        )}
      </div>
    );

  return (
    <div className="page editor plan-editor">
      <div className="crumbs">
        <Link to={listPath}>← {isHomework ? 'Homework' : 'Practices'}</Link>
        <span className={`save-state ${saveState}`} role="status">
          {saveState === 'saved' ? 'All changes saved' : saveState === 'error' ? 'Not saved' : 'Saving…'}
        </span>
      </div>

      {plan.is_template && <p className="banner">This is a template. Use it from the list page to start a new plan.</p>}
      {error && <p className="error">{error}</p>}
      {notice && (
        <p className="banner ok" role="status">
          {notice}{' '}
          <button className="link" onClick={() => setNotice('')}>
            Dismiss
          </button>
        </p>
      )}

      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragStart={(e) => isNew(e.active.id) && setIncoming(String(e.active.id))}
        onDragMove={(e) => {
          if (!isNew(e.active.id) || !incoming) return;
          const spot = landing(e);
          setDropAt(spot ? spot.at : null);
          setDropBeside(!!spot?.beside);
        }}
        onDragCancel={() => {
          setIncoming('');
          setDropAt(null);
          setDropBeside(false);
        }}
        onDragEnd={onDragEnd}
      >
        <div className="card plan-head">
          <div className="fields">
            <Field label={plan.is_template ? 'Template name' : 'Title'} grow>
              <input className="input" value={plan.title} onChange={(e) => update({ title: e.target.value })} />
            </Field>
            {!plan.is_template && (
              <Field label={isHomework ? 'Date assigned' : 'Date'}>
                <input className="input" type="date" value={plan.date} onChange={(e) => update({ date: e.target.value })} />
              </Field>
            )}
            {!isHomework && (
              <>
                <Field label="Start time">
                  <input
                    className="input"
                    type="time"
                    value={plan.start_time}
                    onChange={(e) => update({ start_time: e.target.value || '17:30' })}
                  />
                </Field>
              </>
            )}
          </div>

          <div className={`plan-extra ${isHomework ? 'one' : ''}`}>
            {!isHomework && (
              <Field label="Location">
                <input className="input" value={plan.location} onChange={(e) => update({ location: e.target.value })} />
              </Field>
            )}
            <div className="plan-notes">
              <Field label="Notes">
                <textarea
                  className="input"
                  rows={3}
                  placeholder="Jot down anything for this day: the focus, who is out, what to bring"
                  value={plan.notes}
                  onChange={(e) => update({ notes: e.target.value })}
                />
              </Field>
              <label className="check small">
                <input type="checkbox" checked={plan.print_notes} onChange={(e) => update({ print_notes: e.target.checked })} />
                Show these notes on the printed {sheet}
              </label>
            </div>
          </div>

          {!isHomework && (
            <label className="check game-check">
              <input type="checkbox" checked={plan.is_game} onChange={(e) => update({ is_game: e.target.checked })} />
              <span>
                This is a game plan <span className="muted">(kept out of dashboard category totals and targets)</span>
              </span>
            </label>
          )}

          {isHomework && !plan.is_template && (
            <div className="assigned">
              <span className="field-label">For</span>
              <div className="chips">
                <button
                  type="button"
                  className={`chip toggle ${plan.assigned.length === 0 ? 'on' : ''}`}
                  aria-pressed={plan.assigned.length === 0}
                  onClick={() => update({ assigned: [] })}
                >
                  Whole team
                </button>
                {players
                  .filter((p) => p.active)
                  .map((p) => {
                    const on = plan.assigned.includes(p.id);
                    return (
                      <button
                        key={p.id}
                        type="button"
                        className={`chip toggle ${on ? 'on' : ''}`}
                        aria-pressed={on}
                        onClick={() => update({ assigned: on ? plan.assigned.filter((x) => x !== p.id) : [...plan.assigned, p.id] })}
                      >
                        {p.name}
                      </button>
                    );
                  })}
              </div>
            </div>
          )}

        </div>

        <div className="plan-layout">
          <Palette drills={libraryDrills} tags={tags} withBreak={!isHomework} sheet={sheet} onAdd={addNew} />
          <div className="plan-column" ref={column}>
            {plan.items.length === 0 ? (
              <div className={`empty ${incoming && dropAt !== null ? 'drop-here' : ''}`}>
                <h2>Nothing scheduled yet</h2>
                <p>Start from a {sheet} you have already built, drag a drill in from the left, or add your first item. Each item starts when the one before it ends.</p>
                <button className="btn primary start-from" onClick={() => setStarting(true)}>
                  Start from a previous {sheet}
                </button>
                {inserter(0)}
              </div>
            ) : (
              <SortableContext items={plan.items.map((i) => i.key)} strategy={verticalListSortingStrategy}>
                {groups.map((group) => {
                  const first = group[0];
                  const end = group[group.length - 1] + 1;
                  const shared = group.length > 1;
                  return (
                    <Fragment key={plan.items[first].key}>
                      {incoming && !dropBeside && dropAt === first && dropSlot}
                      <div className={`slot-group ${shared ? 'paired' : ''}`} data-end={end}>
                        {shared && (
                          <p className="slot-shared">
                            {!isHomework && <span className="time">{slotLabel(slots[first])}</span>}
                            <strong>{group.length} at the same time</strong>
                            <button type="button" className="link small" onClick={() => setItems(plan.items.map((it, i) => (group.includes(i) ? { ...it, beside: false } : it)))}>
                              Give each its own time
                            </button>
                          </p>
                        )}
                        <div className="slot-row">
                          {group.map((i) => {
                            const it = plan.items[i];
                            return (
                              <SortableRow
                                key={it.key}
                                still={incoming !== ''}
                                item={it}
                                slot={slots[i]}
                                shared={shared}
                                canJoin={i > 0 && it.kind !== 'break' && plan.items[i - 1].kind !== 'break'}
                                isHomework={isHomework}
                                isOpen={open.has(it.key)}
                                autoFocusTitle={it.key === focusKey}
                                tags={tags}
                                players={players}
                                plays={plays.filter((p) => p.sport_id === team?.sport_id)}
                                onToggle={() => toggle(it.key)}
                                onPatch={(patch) => patchItem(it.key, patch)}
                                onDelete={() => removeItem(it)}
                                onDuplicate={() => insertAt(end, { ...structuredClone(it), key: newKey(), beside: false }, false)}
                                onSaveToLibrary={() => saveToLibrary(it)}
                                onBeside={(beside) => setBeside(it.key, beside)}
                              />
                            );
                          })}
                          {/* While a drill is being dragged in: let go here to run it at the same time as this one. */}
                          {incoming && incoming !== `${NEW}break` && plan.items[first].kind !== 'break' && (
                            <div className={`beside-zone ${dropBeside && dropAt === end ? 'on' : ''}`} data-end={end}>
                              Drop here to run it at the same time
                            </div>
                          )}
                        </div>
                        {inserter(end)}
                      </div>
                    </Fragment>
                  );
                })}
                {/* Under the last item: always there while dragging, so the end of the plan is an easy target. */}
                {incoming && (dropAt === plan.items.length && !dropBeside ? dropSlot : <div className="drop-slot idle">or drop here to add it at the end</div>)}
              </SortableContext>
            )}

          </div>
          <Glance mins={mins} tags={tags} total={total} ends={!isHomework && slots.length > 0 ? fmtClock(slots[slots.length - 1].end) : ''}>
            {!plan.is_template && (
              <button className="btn primary" onClick={openPrint}>
                Print / share
              </button>
            )}
            <MoreMenu items={moreItems} />
          </Glance>
        </div>
        <DragOverlay dropAnimation={null}>{incoming && <div className="palette-tile lifted">{paletteLabel(incoming, drills)}</div>}</DragOverlay>
      </DndContext>

      {importing && team && (
        <ImportModal
          team={team}
          tags={tags}
          players={players}
          drills={drills}
          hasItems={plan.items.length > 0}
          onClose={() => {
            setImporting(false);
            if (searchParams.has('import')) setSearchParams({}, { replace: true });
          }}
          onApply={(items, mode, roster, library) => {
            setDrills(library);
            setItems(mode === 'replace' ? items : [...(latest.current ?? plan).items, ...items]);
            setPlayers(roster);
            setImporting(false);
            if (searchParams.has('import')) setSearchParams({}, { replace: true });
            setNotice(`Imported ${items.filter((i) => i.kind === 'item').length} items. Review them below.`);
          }}
        />
      )}

      {sharing && <ShareDialog kind="plan" itemId={plan.id} title={plan.title || 'Practice'} onClose={() => setSharing(false)} />}
      {communityAt !== null && (
        <CommunityPicker
          kind="drill"
          onClose={() => setCommunityAt(null)}
          onAdded={async (drillId) => {
            // The drill is now in this coach's own library: reload it, then drop it in like any other drill.
            const at = communityAt;
            setCommunityAt(null);
            try {
              const library = await api.drills();
              setDrills(library);
              const d = library.find((x) => x.id === drillId);
              if (d) addDrill(d, at);
            } catch (e) {
              setError((e as Error).message);
            }
          }}
        />
      )}
      {starting && <PreviousPlanPicker current={plan} tags={tags} onPick={startFrom} onClose={() => setStarting(false)} />}

      {pickAt !== null && (
        <DrillPicker
          drills={libraryDrills}
          tags={tags}
          onPick={(d) => addDrill(d, pickAt)}
          onCustom={() => {
            const at = pickAt;
            setPickAt(null);
            if (at !== null) addCustom(at);
          }}
          onClose={() => setPickAt(null)}
        />
      )}
    </div>
  );
}

/** The practice at a glance: which categories it works on, and for how long. */
function Glance({ mins, tags, total, ends, children }: { mins: ReturnType<typeof planMinutes>; tags: Tag[]; total: number; ends: string; /** Print and the other things to do with the whole plan. */ children: ReactNode }) {
  const rows = tags
    .filter((t) => (mins.byTag.get(t.id) || 0) > 0)
    .map((t) => ({ tag: t, minutes: mins.byTag.get(t.id)! }))
    .sort((a, b) => b.minutes - a.minutes);
  const untagged = mins.byTag.get(0) || 0;
  const share = (m: number) => `${Math.min(100, mins.work > 0 ? Math.round((m / mins.work) * 100) : 0)}%`;
  return (
    <aside className="plan-glance" aria-label="At a glance">
      <div className="glance-actions">{children}</div>
      <h2>At a glance</h2>
      <p className="glance-total">
        <strong>{fmtDuration(total)}</strong>
        {ends && <span className="muted"> · ends {ends}</span>}
      </p>
      {rows.length === 0 ? (
        <p className="muted small">Add drills that have categories, and this shows where the time goes.</p>
      ) : (
        <ul className="glance-list">
          {rows.map(({ tag, minutes }) => (
            <li key={tag.id}>
              <span className="glance-name">
                <span className="dot" style={{ background: tag.color }} />
                {tag.name}
              </span>
              <span className="glance-min">{Math.round(minutes)} min</span>
              <span className="glance-bar" title={`${share(minutes)} of the working time`}>
                <i style={{ width: share(minutes), background: tag.color }} />
              </span>
            </li>
          ))}
        </ul>
      )}
      {(untagged > 0 || mins.breaks > 0) && (
        <ul className="glance-list plain">
          {untagged > 0 && (
            <li>
              <span className="glance-name muted">No category</span>
              <span className="glance-min">{Math.round(untagged)} min</span>
            </li>
          )}
          {mins.breaks > 0 && (
            <li>
              <span className="glance-name muted">Breaks</span>
              <span className="glance-min">{Math.round(mins.breaks)} min</span>
            </li>
          )}
        </ul>
      )}
      {rows.length > 0 && <p className="muted small">A drill with two categories counts toward both.</p>}
    </aside>
  );
}

/** The name shown on a tile in the side list, and on the copy that follows the pointer. */
function paletteLabel(id: string, drills: Drill[]) {
  const what = id.slice(NEW.length);
  if (what === 'custom') return 'Custom item';
  if (what === 'break') return 'Break';
  return drills.find((d) => d.id === Number(what.split(':')[1]))?.name ?? 'Drill';
}

/** One thing in the side list. Drag it onto the plan, or click it to add it at the end. */
function PaletteTile({ id, kind, onAdd, children }: { id: string; kind: string; onAdd: (id: string) => void; children: ReactNode }) {
  const { setNodeRef, listeners, isDragging } = useDraggable({ id });
  // Only the pointer starts a drag here, so Enter and Space still press the button.
  return (
    <button type="button" ref={setNodeRef} className={`palette-tile ${kind} ${isDragging ? 'dragging-out' : ''}`} onPointerDown={listeners?.onPointerDown as PointerEventHandler | undefined} onClick={() => onAdd(id)}>
      {children}
    </button>
  );
}

/** The list down the left side: a custom item, a break, and every drill in the library for this sport. */
function Palette({ drills, tags, withBreak, sheet, onAdd }: { drills: Drill[]; tags: Tag[]; withBreak: boolean; sheet: string; onAdd: (id: string) => void }) {
  const [q, setQ] = useState('');
  const [tagId, setTagId] = useState(0);
  const text = q.trim().toLowerCase();
  const shown = drills
    .filter((d) => (!text || `${d.name} ${htmlPreview(d.notes_html)}`.toLowerCase().includes(text)) && (tagId === 0 || d.tag_ids.includes(tagId)))
    .sort((a, b) => a.name.localeCompare(b.name));
  // Only offer categories that some drill actually has.
  const usedTags = tags.filter((t) => drills.some((d) => d.tag_ids.includes(t.id)));
  return (
    <aside className="plan-palette" aria-label={`Add to this ${sheet}`}>
      <h2>Add to this {sheet}</h2>
      <p className="muted small">Drag onto the plan where you want it, or click to add it at the end.</p>
      <div className="palette-blocks">
        <PaletteTile id={`${NEW}custom`} kind="block" onAdd={onAdd}>
          <span className="palette-grip" aria-hidden="true">
            ⠿
          </span>
          Custom item
        </PaletteTile>
        {withBreak && (
          <PaletteTile id={`${NEW}break`} kind="block" onAdd={onAdd}>
            <span className="palette-grip" aria-hidden="true">
              ⠿
            </span>
            Break
          </PaletteTile>
        )}
      </div>
      <h3 className="side-label">
        Drills <span className="chip-num">{drills.length}</span>
      </h3>
      {drills.length === 0 ? (
        <p className="muted small">
          No drills yet. Add them on the <Link to="/library">Drills</Link> page, or use "Save to drill library" on an item.
        </p>
      ) : (
        <>
          <input className="input" aria-label="Search drills" placeholder="Search drills" value={q} onChange={(e) => setQ(e.target.value)} />
          {usedTags.length > 0 && (
            <select className="input" aria-label="Filter drills by category" value={tagId} onChange={(e) => setTagId(Number(e.target.value))}>
              <option value={0}>All categories</option>
              {usedTags.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
          )}
          <div className="palette-list">
            {shown.length === 0 && <p className="muted small">No drills match.</p>}
            {shown.map((d) => (
              <PaletteTile key={d.id} id={`${NEW}drill:${d.id}`} kind="drill" onAdd={onAdd}>
                <span className="palette-grip" aria-hidden="true">
                  ⠿
                </span>
                <span className="palette-name">{d.name}</span>
                <span className="palette-meta">
                  {tags
                    .filter((t) => d.tag_ids.includes(t.id))
                    .map((t) => (
                      <span key={t.id} className="dot" style={{ background: t.color }} title={t.name} />
                    ))}
                  {d.duration_min} min
                </span>
              </PaletteTile>
            ))}
          </div>
        </>
      )}
    </aside>
  );
}

function SortableRow(props: {
  item: Item;
  slot: Slot;
  isHomework: boolean;
  isOpen: boolean;
  /** True for a custom item that was just added, so typing goes straight into its title. */
  autoFocusTitle: boolean;
  /** True while something is being dragged in: the rows stay put and only the line shows where it lands. */
  still: boolean;
  /** True when it shares its time slot with another item. The slot's time is shown once, above them. */
  shared: boolean;
  /** Whether it could run at the same time as the item above it. */
  canJoin: boolean;
  onBeside: (beside: boolean) => void;
  tags: Tag[];
  players: Player[];
  plays: Play[];
  onToggle: () => void;
  onPatch: (patch: Partial<Item>) => void;
  onDelete: () => void;
  onDuplicate: () => void;
  onSaveToLibrary: () => void;
}) {
  const { item, slot, isHomework, isOpen, tags, players, onPatch } = props;
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: item.key });
  const isBreak = item.kind === 'break';
  const card = useRef<HTMLDivElement>(null);
  /** Closes the details and brings the item's header back into view, since the bottom button may be far below it. */
  const collapse = () => {
    props.onToggle();
    requestAnimationFrame(() => card.current?.scrollIntoView({ block: 'nearest' }));
  };
  const itemTags = tags.filter((t) => item.tag_ids.includes(t.id));
  const preview = htmlPreview(item.notes_html);
  const resourceCount = item.images.length + item.videos.length + item.links.length;
  const extras = [
    item.groups.length > 0 && `${item.groups.length} group${item.groups.length === 1 ? '' : 's'}`,
    item.play_ids.length > 0 && `${item.play_ids.length} play${item.play_ids.length === 1 ? '' : 's'}`,
    resourceCount > 0 && `${resourceCount} resource${resourceCount === 1 ? '' : 's'}`,
    !isBlankHtml(item.coach_notes_html) && 'coach notes',
    item.player_notes.length > 0 && `${item.player_notes.length} player note${item.player_notes.length === 1 ? '' : 's'}`,
  ].filter(Boolean);

  return (
    <div ref={setNodeRef} style={props.still ? undefined : { transform: CSS.Translate.toString(transform), transition }} className={`sheet-row ${isDragging ? 'dragging' : ''}`}>
      <div
        ref={card}
        className={`card item ${isBreak ? 'break' : ''} ${isOpen ? 'open' : ''}`}
        onKeyDown={(e) => {
          // Escape collapses an open item, unless a dialog or picker inside it is handling the key.
          if (e.key === 'Escape' && isOpen && !(e.target as HTMLElement).closest('.modal')) {
            e.stopPropagation();
            collapse();
          }
        }}
      >
        <div className="item-head">
          <button type="button" className="handle" aria-label="Drag to reorder" {...attributes} {...listeners}>
            ⠿
          </button>
          {!isHomework && !props.shared && <span className="time">{slotLabel(slot)}</span>}
          <input
            className="input title"
            aria-label="Item title"
            autoFocus={props.autoFocusTitle}
            placeholder={isBreak ? 'Break' : 'Item title, such as Dribble warm up'}
            value={item.title}
            onChange={(e) => onPatch({ title: e.target.value })}
          />
          {isHomework && (
            <input
              className="input reps"
              aria-label="Reps or amount"
              placeholder="Reps, such as 3 x 20"
              value={item.reps}
              onChange={(e) => onPatch({ reps: e.target.value })}
            />
          )}
          <label className="dur">
            <input
              className="input"
              type="number"
              min={0}
              step={5}
              aria-label="Minutes"
              value={item.duration_min}
              onChange={(e) => onPatch({ duration_min: Math.max(0, Math.round(Number(e.target.value) || 0)) })}
            />
            min
          </label>
          {!isBreak && (
            <button type="button" className={`btn small ${isOpen ? 'primary' : ''}`} aria-expanded={isOpen} onClick={props.onToggle}>
              {isOpen ? '▲ Collapse' : 'Details'}
            </button>
          )}
          <button type="button" className="btn ghost" aria-label="Delete item" onClick={props.onDelete}>
            ✕
          </button>
        </div>

        {!isBreak && !isOpen && (itemTags.length > 0 || preview || extras.length > 0) && (
          <button type="button" className="item-preview" onClick={props.onToggle}>
            {itemTags.length > 0 && (
              <span className="chips">
                {itemTags.map((t) => (
                  <TagChip key={t.id} tag={t} />
                ))}
              </span>
            )}
            {preview && <span className="preview-text">{preview}</span>}
            {extras.length > 0 && <span className="muted small">{extras.join(' · ')}</span>}
          </button>
        )}
        {!isBreak && !isOpen && itemTags.length === 0 && (
          <p className="untagged">No category yet. This time will not count toward your dashboard.</p>
        )}

        {!isBreak && isOpen && (
          <>
            <ItemBody value={item} onChange={onPatch} tags={tags} players={players} plays={props.plays} />
            <div className="item-foot">
              <button type="button" className="btn small collapse-btn" onClick={collapse}>
                ▲ Collapse
              </button>
              <span className="spacer" />
              {(props.canJoin || item.beside) && (
                <button type="button" className="btn small" onClick={() => props.onBeside(!item.beside)} title={item.beside ? 'It gets a time slot of its own again' : 'Both run at once and share one start and end time'}>
                  {item.beside ? 'Give it its own time' : 'Run at the same time as the item above'}
                </button>
              )}
              <button type="button" className="btn small" onClick={props.onDuplicate}>
                Duplicate item
              </button>
              <button type="button" className="btn small" onClick={props.onSaveToLibrary}>
                Save to drill library
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

/** Fills the practice being edited from an old plan: pick a source, review Claude's draft, then add it. */
function ImportModal(props: {
  team: Team;
  tags: Tag[];
  players: Player[];
  drills: Drill[];
  hasItems: boolean;
  onClose: () => void;
  onApply: (items: Item[], mode: 'append' | 'replace', roster: Player[], drills: Drill[]) => void;
}) {
  const app = useApp();
  const status = useAiStatus();
  const [phase, setPhase] = useState<'pick' | 'analyzing' | 'review' | 'applying'>('pick');
  const [name, setName] = useState('');
  const [draft, setDraft] = useState<ImportDraft | null>(null);
  const [choices, setChoices] = useState<DraftChoices | null>(null);
  const [error, setError] = useState('');

  const review = (n: string, d: ImportDraft) => {
    setName(n);
    setDraft(d);
    setChoices(defaultChoices(d));
    setPhase('review');
  };
  const apply = async (mode: 'append' | 'replace') => {
    setPhase('applying');
    try {
      const { items, roster, drills } = await resolveDraft(draft!, props.team, choices!);
      await app.reload();
      props.onApply(items, mode, roster, drills);
    } catch (e) {
      setError(`Could not import: ${(e as Error).message}`);
      setPhase('review');
    }
  };

  return (
    <Modal title="Import a plan into this practice" onClose={props.onClose} wide>
      {error && <p className="error">{error}</p>}
      {phase === 'pick' && (
        <>
          <p className="muted">
            Upload the plan you ran. Claude turns it into items with times, notes, groups and categories. This practice keeps its own date, start
            time and location.
          </p>
          <SourcePicker
            teamId={props.team.id}
            status={status}
            onDraft={review}
            onSource={async (n, source) => {
              setName(n);
              setError('');
              setPhase('analyzing');
              try {
                review(n, await api.importPlan(props.team.id, source));
              } catch (e) {
                setError((e as Error).message);
                setPhase('pick');
              }
            }}
          />
        </>
      )}
      {phase === 'analyzing' && (
        <p className="muted" role="status">
          Claude is reading {name}. This usually takes under a minute…
        </p>
      )}
      {(phase === 'review' || phase === 'applying') && draft && choices && (
        <DraftReview draft={draft} choices={choices} tags={props.tags} players={props.players} drills={props.drills} sportId={props.team.sport_id} onDraft={setDraft} onChoices={setChoices}>
          <div className="modal-foot">
            <button className="btn" onClick={() => setPhase('pick')} disabled={phase === 'applying'}>
              Back
            </button>
            {props.hasItems && (
              <button className="btn danger" onClick={() => apply('replace')} disabled={phase === 'applying'}>
                Replace current items
              </button>
            )}
            <button className="btn primary" onClick={() => apply('append')} disabled={phase === 'applying'}>
              {phase === 'applying' ? 'Importing…' : props.hasItems ? 'Add to the end' : 'Add to this practice'}
            </button>
          </div>
        </DraftReview>
      )}
    </Modal>
  );
}

/** Choose an earlier practice (or a template) to copy the items from. */
function PreviousPlanPicker({ current, tags, onPick, onClose }: { current: Plan; tags: Tag[]; onPick: (p: Plan) => void; onClose: () => void }) {
  const [plans, setPlans] = useState<Plan[] | null>(null);
  const [error, setError] = useState('');
  const [q, setQ] = useState('');
  const noun = current.kind === 'homework' ? 'homework sheet' : 'practice';
  useEffect(() => {
    (async () => {
      try {
        const [dated, templates] = await Promise.all([api.plansFull(current.team_id, current.kind), api.plans(current.team_id, current.kind, true)]);
        // Templates come without their items, so fetch each one in full.
        const fullTemplates = await Promise.all(templates.map((t) => api.plan(t.id)));
        setPlans([...fullTemplates, ...dated].filter((p) => p.id !== current.id && p.items.length > 0));
      } catch (e) {
        setError((e as Error).message);
      }
    })();
  }, [current.id, current.team_id, current.kind]);
  const tagIds = new Set(tags.map((t) => t.id));
  const text = q.trim().toLowerCase();
  const shown = (plans || []).filter(
    (p) => !text || `${p.title} ${p.location} ${fmtDateShort(p.date)} ${p.items.map((i) => i.title).join(' ')}`.toLowerCase().includes(text),
  );
  return (
    <Modal title={`Start from a previous ${noun}`} onClose={onClose} wide>
      {error && <p className="error">{error}</p>}
      <div className="picker-filters">
        <input className="input grow" autoFocus placeholder="Search by date, title or an item in it" value={q} onChange={(e) => setQ(e.target.value)} />
      </div>
      {plans === null ? (
        <p className="muted">Loading…</p>
      ) : shown.length === 0 ? (
        <p className="muted">{plans.length === 0 ? `There is no earlier ${noun} to start from yet.` : 'Nothing matches.'}</p>
      ) : (
        <ul className="picker drill-picker">
          {shown.map((p) => {
            const mins = planMinutes(p, tagIds);
            return (
              <li key={p.id}>
                <button type="button" onClick={() => onPick(p)}>
                  <span className="picker-top">
                    <span className="picker-name">{p.is_template ? p.title || 'Template' : fmtDateShort(p.date)}</span>
                    {p.is_template ? <span className="kind">Template</span> : <span>{p.title}</span>}
                    {p.is_game && <span className="kind game">Game</span>}
                    <span className="muted small">
                      {[p.location, fmtDuration(mins.work + mins.breaks), `${p.items.filter((i) => i.kind === 'item').length} items`].filter(Boolean).join(' · ')}
                    </span>
                    <span className="chips">
                      {tags
                        .filter((t) => mins.byTag.has(t.id))
                        .map((t) => (
                          <TagChip key={t.id} tag={t} />
                        ))}
                    </span>
                  </span>
                  <span className="picker-notes muted small">
                    {p.items
                      .filter((i) => i.kind === 'item')
                      .map((i) => i.title || 'Untitled')
                      .join(' · ')}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </Modal>
  );
}

function DrillPicker({
  drills,
  tags,
  onPick,
  onCustom,
  onClose,
}: {
  drills: Drill[];
  tags: Tag[];
  onPick: (d: Drill) => void;
  onCustom: () => void;
  onClose: () => void;
}) {
  const [q, setQ] = useState('');
  const [tagId, setTagId] = useState(0);
  const text = q.trim().toLowerCase();
  const shown = drills.filter(
    (d) => (!text || `${d.name} ${htmlPreview(d.notes_html)}`.toLowerCase().includes(text)) && (tagId === 0 || d.tag_ids.includes(tagId)),
  );
  // Only offer categories that some drill actually has.
  const usedTags = tags.filter((t) => drills.some((d) => d.tag_ids.includes(t.id)));
  return (
    <Modal title="Choose a drill" onClose={onClose} wide>
      <div className="picker-filters">
        <input className="input grow" autoFocus placeholder="Search drills by name or notes" value={q} onChange={(e) => setQ(e.target.value)} />
      </div>
      {usedTags.length > 0 && (
        <div className="chips category-filter" role="group" aria-label="Filter by category">
          <button type="button" className={`chip toggle ${tagId === 0 ? 'on' : ''}`} aria-pressed={tagId === 0} onClick={() => setTagId(0)}>
            All <span className="chip-num">{drills.length}</span>
          </button>
          {usedTags.map((t) => (
            <button key={t.id} type="button" className={`chip toggle ${tagId === t.id ? 'on' : ''}`} aria-pressed={tagId === t.id} onClick={() => setTagId(tagId === t.id ? 0 : t.id)}>
              <span className="dot" style={{ background: t.color }} />
              {t.name} <span className="chip-num">{drills.filter((d) => d.tag_ids.includes(t.id)).length}</span>
            </button>
          ))}
        </div>
      )}
      {shown.length === 0 ? (
        <p className="muted">
          {drills.length === 0 ? 'Your drill library is empty. Add a custom item, then use "Save to drill library" on it to reuse it.' : 'No drills match.'}
        </p>
      ) : (
        <ul className="picker drill-picker">
          {shown.map((d) => {
            const resources = (d.images || []).length + (d.videos || []).length + (d.links || []).length;
            const preview = htmlPreview(d.notes_html);
            return (
              <li key={d.id}>
                <button type="button" onClick={() => onPick(d)}>
                  <span className="picker-top">
                    <span className="picker-name">{d.name}</span>
                    <span className="muted small">
                      {[`${d.duration_min} min`, resources > 0 && `${resources} resource${resources === 1 ? '' : 's'}`, (d.play_ids || []).length > 0 && `${d.play_ids.length} play${d.play_ids.length === 1 ? '' : 's'}`]
                        .filter(Boolean)
                        .join(' · ')}
                    </span>
                    <span className="chips">
                      {tags
                        .filter((t) => d.tag_ids.includes(t.id))
                        .map((t) => (
                          <TagChip key={t.id} tag={t} />
                        ))}
                    </span>
                  </span>
                  {preview && <span className="picker-notes muted small">{preview}</span>}
                </button>
              </li>
            );
          })}
        </ul>
      )}
      <div className="modal-foot">
        <span className="muted small grow">Not in the library?</span>
        <button type="button" className="btn" onClick={onCustom}>
          Add a custom item instead
        </button>
      </div>
    </Modal>
  );
}
