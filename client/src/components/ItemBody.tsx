import { useState } from 'react';
import { Link } from 'react-router-dom';
import type { Group, ItemContent, Play, Player, PlayerNote, Tag } from '../types';
import { PlayDiagram } from './PlayDiagram';
import { isBlankHtml } from '../util';
import RichText from './RichText';
import { TagPicker } from './bits';
import Attachments from './Attachments';

interface Props {
  value: ItemContent & { player_notes?: PlayerNote[] };
  onChange: (patch: Partial<ItemContent & { player_notes: PlayerNote[] }>) => void;
  tags: Tag[];
  /** Pass the roster to enable player assignment and player notes. Omit for library drills. */
  players?: Player[];
  /** The playbook, to attach plays for reference. */
  plays?: Play[];
  /** Lays the extras out as a grid of cards, each with its own sign: used where the drill is edited on its own. */
  cards?: boolean;
}

const SIGNS = {
  resources: 'M4 6h16v12H4zM10 9.500v5l4.500-2.500z',
  plays: 'M7 5.500v13l11-6.500z',
  groups: 'M9 11a3.500 3.500 0 1 0 0-7 3.500 3.500 0 0 0 0 7ZM2.500 20c.600-3.600 3.200-5.500 6.500-5.500s5.900 1.900 6.500 5.500M16 4.300a3.500 3.500 0 0 1 0 6.400M18 14.900c1.900.700 3.100 2.400 3.500 5.100',
  coach: 'M6.500 11h11v9h-11zM8.500 11V8a3.500 3.500 0 0 1 7 0v3',
};
/** The sign at the head of a card. Only drawn in the card layout. */
const Sign = ({ d }: { d: string }) => (
  <svg className="ib-sign" viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.600" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d={d} />
  </svg>
);

/** The editable content shared by practice items and library drills. */
export default function ItemBody({ value, onChange, tags, players, plays, cards }: Props) {
  const playIds = value.play_ids || [];
  const attached = playIds.map((pid) => plays?.find((p) => p.id === pid)).filter((p): p is Play => !!p);
  const available = (plays || []).filter((p) => !playIds.includes(p.id));
  const playerNotes = value.player_notes || [];
  // The coach-only box stays out of the way until there is something in it, or the coach asks for it.
  const [showCoach, setShowCoach] = useState(() => !isBlankHtml(value.coach_notes_html) || (value.player_notes || []).length > 0);
  const roster = (players || []).filter((p) => p.active);
  const nameOf = (id: number) => players?.find((p) => p.id === id)?.name || 'Removed player';

  const setGroup = (i: number, patch: Partial<Group>) =>
    onChange({ groups: value.groups.map((g, j) => (j === i ? { ...g, ...patch } : g)) });

  return (
    <div className={`item-body ${cards ? 'cards' : ''}`}>
      <section>
        <h4>Categories {cards && <span className="hint">Select one or more categories to help organize and find this drill.</span>}</h4>
        <TagPicker tags={tags} value={value.tag_ids} onChange={(tag_ids) => onChange({ tag_ids })} />
      </section>

      <section>
        <h4>Notes {cards && <span className="hint">Describe the drill, key coaching points, and focus areas.</span>}</h4>
        <RichText ariaLabel="Notes" value={value.notes_html} onChange={(notes_html) => onChange({ notes_html })} />
      </section>

      {/* In the card layout these four sit two by two. One that has something in it takes the full width. */}
      <div className="ib-grid">
      <section className={(value.images || []).length + (value.videos || []).length + (value.links || []).length > 0 ? 'full' : ''}>
        <h4>
          <Sign d={SIGNS.resources} />
          Resources <span className="hint">Pictures, videos and links. Pictures print under the notes.</span>
        </h4>
        <Attachments images={value.images || []} videos={value.videos || []} links={value.links || []} onChange={onChange} />
      </section>

      {plays && (
        <section className={attached.length > 0 ? 'full' : ''}>
          <h4>
            <Sign d={SIGNS.plays} />
            Plays <span className="hint">Attached from your playbook. They print with the item, and always show the play as it is now.</span>
          </h4>
          {attached.length > 0 && (
            <div className="attached-plays">
              {attached.map((p) => (
                <div key={p.id} className="attached-play">
                  <div className="paper">
                    <PlayDiagram play={p} frame={p.frames[0]} />
                  </div>
                  <div className="attached-play-info">
                    <Link to={`/plays/${p.id}`} className="attached-play-name">
                      {p.name}
                    </Link>
                    <span className="muted small">
                      {[p.category, `${p.frames.length} step${p.frames.length === 1 ? '' : 's'}`].filter(Boolean).join(' · ')}
                    </span>
                    <button type="button" className="btn small danger" onClick={() => onChange({ play_ids: playIds.filter((x) => x !== p.id) })}>
                      Detach
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
          {available.length > 0 ? (
            <select
              className="input play-attach"
              aria-label="Attach a play"
              value=""
              onChange={(e) => e.target.value && onChange({ play_ids: [...playIds, Number(e.target.value)] })}
            >
              <option value="">+ Attach a play…</option>
              {available.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                  {p.category ? ` (${p.category})` : ''}
                </option>
              ))}
            </select>
          ) : (
            attached.length === 0 && (
              <p className="muted small">
                No plays yet. Draw one in the <Link to="/playbook">playbook</Link>, then attach it here.
              </p>
            )
          )}
        </section>
      )}

      <section className={value.groups.length > 0 ? 'full' : ''}>
        <h4>
          <Sign d={SIGNS.groups} />
          Stations and groups <span className="hint">Each one prints as a column.</span>
        </h4>
        {value.groups.length > 0 && (
          <div className="groups">
            {value.groups.map((g, i) => (
              <GroupCard
                key={`${i}/${value.groups.length}`}
                index={i}
                group={g}
                roster={players ? roster : undefined}
                nameOf={nameOf}
                onChange={(patch) => setGroup(i, patch)}
                onRemove={() => onChange({ groups: value.groups.filter((_, j) => j !== i) })}
              />
            ))}
          </div>
        )}
        <button
          type="button"
          className="btn small"
          onClick={() => onChange({ groups: [...value.groups, { name: '', notes_html: '', members: [] }] })}
        >
          + Add station or group
        </button>
      </section>

      {showCoach ? (
        <section className="coach-only full">
          <h4>
            <Sign d={SIGNS.coach} />
            Coach only <span className="hint">Never shown on sheets for parents or players.</span>
          </h4>
          <RichText
            ariaLabel="Coach notes"
            value={value.coach_notes_html}
            onChange={(coach_notes_html) => onChange({ coach_notes_html })}
          />
          {players && (
            <div className="player-notes">
              {playerNotes.map((n, i) => (
                <div className="player-note" key={i}>
                  <select
                    className="input"
                    aria-label="Player"
                    value={n.player_id}
                    onChange={(e) =>
                      onChange({
                        player_notes: playerNotes.map((x, j) => (j === i ? { ...x, player_id: Number(e.target.value) } : x)),
                      })
                    }
                  >
                    {!roster.some((p) => p.id === n.player_id) && <option value={n.player_id}>{nameOf(n.player_id)}</option>}
                    {roster.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                  </select>
                  <input
                    className="input grow"
                    aria-label="Note"
                    placeholder="Note for this player"
                    value={n.note}
                    onChange={(e) =>
                      onChange({ player_notes: playerNotes.map((x, j) => (j === i ? { ...x, note: e.target.value } : x)) })
                    }
                  />
                  <button
                    type="button"
                    className="btn ghost"
                    aria-label="Remove player note"
                    onClick={() => onChange({ player_notes: playerNotes.filter((_, j) => j !== i) })}
                  >
                    ✕
                  </button>
                </div>
              ))}
              {roster.length > 0 ? (
                <button
                  type="button"
                  className="btn small"
                  onClick={() => onChange({ player_notes: [...playerNotes, { player_id: roster[0].id, note: '' }] })}
                >
                  + Add player note
                </button>
              ) : (
                <p className="muted small">Add players on the Teams &amp; rosters page to write player notes.</p>
              )}
            </div>
          )}
        </section>
      ) : cards ? (
        <section>
          <h4>
            <Sign d={SIGNS.coach} />
            Coach-only note <span className="hint">Only coaches see it. Never shown on sheets for parents or players.</span>
          </h4>
          <button type="button" className="btn small" onClick={() => setShowCoach(true)}>
            + Add a coach-only note
          </button>
        </section>
      ) : (
        <div className="coach-add">
          <button type="button" className="btn small" onClick={() => setShowCoach(true)}>
            + Add a coach-only note
          </button>
          <span className="muted small">Never shown to parents or players.</span>
        </div>
      )}
      </div>
    </div>
  );
}

function GroupCard({
  index,
  group,
  roster,
  nameOf,
  onChange,
  onRemove,
}: {
  index: number;
  group: Group;
  roster?: Player[];
  nameOf: (id: number) => string;
  onChange: (patch: Partial<Group>) => void;
  onRemove: () => void;
}) {
  const [showNotes, setShowNotes] = useState(!isBlankHtml(group.notes_html));
  const available = (roster || []).filter((p) => !group.members.some((m) => m.player_id === p.id));

  return (
    <div className="group">
      <div className="group-head">
        <input
          className="input grow"
          aria-label={`Name of group ${index + 1}`}
          placeholder={`Group ${index + 1} name (optional)`}
          value={group.name}
          onChange={(e) => onChange({ name: e.target.value })}
        />
        <button type="button" className="btn ghost" aria-label={`Remove group ${index + 1}`} onClick={onRemove}>
          ✕
        </button>
      </div>

      {showNotes ? (
        <RichText ariaLabel={`Group ${index + 1} notes`} value={group.notes_html} onChange={(notes_html) => onChange({ notes_html })} />
      ) : (
        <button type="button" className="link small" onClick={() => setShowNotes(true)}>
          + Add notes for this group
        </button>
      )}

      {roster && (
        <div className="members">
          {group.members.map((m, i) => (
            <div className="member" key={m.player_id}>
              <span className="member-name">{nameOf(m.player_id)}</span>
              <input
                className="input role"
                aria-label={`Position for ${nameOf(m.player_id)}`}
                placeholder="Position"
                value={m.role}
                onChange={(e) =>
                  onChange({ members: group.members.map((x, j) => (j === i ? { ...x, role: e.target.value } : x)) })
                }
              />
              <button
                type="button"
                className="btn ghost"
                aria-label={`Remove ${nameOf(m.player_id)}`}
                onClick={() => onChange({ members: group.members.filter((_, j) => j !== i) })}
              >
                ✕
              </button>
            </div>
          ))}
          {available.length > 0 && (
            <select
              className="input"
              aria-label={`Add a player to group ${index + 1}`}
              value=""
              onChange={(e) => {
                const p = roster.find((x) => x.id === Number(e.target.value));
                if (p) onChange({ members: [...group.members, { player_id: p.id, role: p.position }] });
              }}
            >
              <option value="">+ Add player…</option>
              {available.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                  {p.position ? ` (${p.position})` : ''}
                </option>
              ))}
            </select>
          )}
        </div>
      )}
    </div>
  );
}
