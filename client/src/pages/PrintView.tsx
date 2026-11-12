import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api } from '../api';
import { useApp } from '../App';
import type { Group, Item, Plan, Play, Player } from '../types';
import { PlaySteps } from '../components/PlayDiagram';
import { SheetLinks } from '../components/ItemMedia';
import { imageUrl } from '../components/ItemImages';
import { clean, fmtDateSheet, isBlankHtml, schedule, slotLabel } from '../util';

/** Who the sheet is for. Coach-only content appears in 'coach' and nowhere else. */
type Audience = 'simple' | 'notes' | 'coach';
const AUDIENCES: { id: Audience; label: string; hint: string }[] = [
  { id: 'simple', label: 'Simple', hint: 'Times and titles only.' },
  { id: 'notes', label: 'With notes', hint: 'Adds notes and groups. Coach-only notes stay hidden.' },
  { id: 'coach', label: 'Coach copy', hint: 'Everything, including coach-only and player notes. Do not send to parents.' },
];

// Inline styles so the sheet keeps its shape when pasted into an email.
const cell: CSSProperties = { border: '1px solid #999', padding: '6px 10px', verticalAlign: 'top', textAlign: 'left' };
const table: CSSProperties = { borderCollapse: 'collapse', margin: '8px 0 12px' };

export default function PrintView() {
  const { id } = useParams();
  const app = useApp();
  const [plan, setPlan] = useState<Plan | null>(null);
  const [players, setPlayers] = useState<Player[]>([]);
  const [plays, setPlays] = useState<Play[]>([]);
  const [error, setError] = useState('');
  const [audience, setAudience] = useState<Audience>('notes');
  const [showBreaks, setShowBreaks] = useState(false);
  const [showTags, setShowTags] = useState(false);
  const [copied, setCopied] = useState('');
  const sheet = useRef<HTMLDivElement>(null);

  useEffect(() => {
    (async () => {
      try {
        const p = await api.plan(Number(id));
        setPlan(p);
        setPlayers(await api.players(p.team_id));
        setPlays(await api.plays());
      } catch (e) {
        setError((e as Error).message);
      }
    })();
  }, [id]);

  const slots = useMemo(() => (plan ? schedule(plan.start_time, plan.items) : []), [plan]);
  if (error) return <div className="page error">{error}</div>;
  if (!plan) return <div className="page muted">Loading…</div>;

  const isHomework = plan.kind === 'homework';
  const team = app.teams.find((t) => t.id === plan.team_id);
  const nameOf = (pid: number) => players.find((p) => p.id === pid)?.name || '';
  const tagName = (tid: number) => app.tags.find((t) => t.id === tid)?.name;
  const heading = [plan.title || (isHomework ? 'Homework' : 'Practice'), fmtDateSheet(plan.date)].filter(Boolean).join(' - ');
  const assignedNames = plan.assigned.map(nameOf).filter(Boolean);

  const recipients = players
    .filter((p) => p.active && p.parent_email && (plan.assigned.length === 0 || plan.assigned.includes(p.id)))
    .map((p) => p.parent_email);
  const mailto = `mailto:?bcc=${encodeURIComponent([...new Set(recipients)].join(','))}&subject=${encodeURIComponent(
    `${team?.name || ''} ${heading}`.trim(),
  )}`;

  const copy = async () => {
    if (!sheet.current) return;
    try {
      await navigator.clipboard.write([
        new ClipboardItem({
          'text/html': new Blob([sheet.current.innerHTML], { type: 'text/html' }),
          'text/plain': new Blob([sheet.current.innerText], { type: 'text/plain' }),
        }),
      ]);
      setCopied('Copied. Paste it into an email or message.');
    } catch {
      setCopied('Your browser blocked the copy. Select the sheet and copy it by hand.');
    }
  };

  return (
    <div className="print-page">
      <div className="print-bar no-print">
        <Link className="btn" to={`/plans/${plan.id}`}>
          ← Back to editor
        </Link>
        <div className="seg" role="group" aria-label="Sheet version">
          {AUDIENCES.map((a) => (
            <button key={a.id} className={audience === a.id ? 'on' : ''} aria-pressed={audience === a.id} title={a.hint} onClick={() => setAudience(a.id)}>
              {a.label}
            </button>
          ))}
        </div>
        {!isHomework && (
          <label className="check">
            <input type="checkbox" checked={showBreaks} onChange={(e) => setShowBreaks(e.target.checked)} /> Show breaks
          </label>
        )}
        <label className="check">
          <input type="checkbox" checked={showTags} onChange={(e) => setShowTags(e.target.checked)} /> Show categories
        </label>
        <span className="spacer" />
        <button className="btn" onClick={copy}>
          Copy for email
        </button>
        {recipients.length > 0 && audience !== 'coach' && (
          <a className="btn" href={mailto} title="Opens your email app with parents in BCC. Paste the copied sheet into the message.">
            Email parents ({new Set(recipients).size})
          </a>
        )}
        <button className="btn primary" onClick={() => window.print()}>
          Print
        </button>
      </div>
      <p className="print-hint no-print" role="status">
        {copied || AUDIENCES.find((a) => a.id === audience)!.hint}
      </p>

      <div className={`sheet ${audience === 'coach' ? 'coach' : ''}`} ref={sheet}>
        <p className="sheet-head" style={{ color: '#666', fontWeight: 700, fontSize: '15pt', margin: '0 0 14px' }}>
          {heading}
          {plan.location ? ` (${plan.location})` : ''}
          {audience === 'coach' ? ' · Coach copy' : ''}
        </p>
        {isHomework && assignedNames.length > 0 && (
          <p style={{ margin: '0 0 12px' }}>
            <strong>For:</strong> {assignedNames.join(', ')}
          </p>
        )}

        {plan.print_notes && plan.notes.trim() && (
          <p className="plan-jottings" style={{ margin: '0 0 14px', whiteSpace: 'pre-wrap' }}>
            <strong>Notes:</strong> {plan.notes.trim()}
          </p>
        )}

        {plan.items.map((it, i) => {
          if (it.kind === 'break') {
            if (!showBreaks || isHomework) return null;
            return (
              <p key={it.key} className="sheet-break" style={{ color: '#666', margin: '10px 0' }}>
                ({slotLabel(slots[i])}) {it.title || 'Break'}
              </p>
            );
          }
          return (
            <section key={it.key} className="sheet-item">
              <h2 style={{ fontSize: '19pt', margin: '18px 0 8px', lineHeight: 1.2 }}>
                {isHomework ? '☐ ' : `(${slotLabel(slots[i])}) `}
                {it.title || 'Untitled'}
              </h2>
              {isHomework && (it.reps || it.duration_min > 0) && (
                <p style={{ margin: '0 0 6px', fontWeight: 700 }}>
                  {[it.reps, it.duration_min > 0 && `about ${it.duration_min} min`].filter(Boolean).join(' · ')}
                </p>
              )}
              {showTags && it.tag_ids.length > 0 && (
                <p style={{ margin: '0 0 6px', color: '#666', fontSize: '9.5pt' }}>
                  Focus: {it.tag_ids.map(tagName).filter(Boolean).join(', ')}
                </p>
              )}
              {audience !== 'simple' && (
                <>
                  {!isBlankHtml(it.notes_html) && <div className="sheet-notes" dangerouslySetInnerHTML={clean(it.notes_html)} />}
                  {(it.images || []).map((im, k) => (
                    <figure key={k} className="sheet-figure" style={{ margin: '8px 0', width: `${im.width_pct}%` }}>
                      <img src={imageUrl(im.id)} alt={im.caption || 'Diagram'} style={{ width: '100%', display: 'block' }} />
                      {im.caption && <figcaption style={{ fontSize: '9pt', color: '#444', marginTop: 3 }}>{im.caption}</figcaption>}
                    </figure>
                  ))}
                  {(it.play_ids || [])
                    .map((pid) => plays.find((p) => p.id === pid))
                    .filter((p): p is Play => !!p)
                    .map((p) => (
                      <div key={p.id} className="sheet-play" style={{ margin: '10px 0' }}>
                        <p style={{ fontWeight: 700, margin: '0 0 4px' }}>{p.name}</p>
                        <PlaySteps play={p} columns={Math.max(3, Math.min(4, p.frames.length))} />
                      </div>
                    ))}
                  <SheetLinks links={it.links || []} videos={(it.videos || []).length} />
                  <Groups groups={it.groups} nameOf={nameOf} />
                </>
              )}
              {audience === 'coach' && <CoachBlock item={it} nameOf={nameOf} />}
            </section>
          );
        })}
      </div>
    </div>
  );
}

function Groups({ groups: all, nameOf }: { groups: Group[]; nameOf: (id: number) => string }) {
  if (all.length === 0) return null;
  // Players who have since been removed from the roster are left off the sheet.
  const groups = all.map((g) => ({ ...g, members: g.members.filter((m) => nameOf(m.player_id)) }));
  const hasNotes = groups.some((g) => !isBlankHtml(g.notes_html));
  const hasNames = groups.some((g) => g.name.trim());
  const member = (m: Group['members'][number]) => (
    <>
      {nameOf(m.player_id)}
      {m.role && <span style={{ color: '#666', fontSize: '8.5pt' }}> {m.role}</span>}
    </>
  );

  if (hasNotes) {
    // Stations: one bordered box, one column per station.
    return (
      <table className="sheet-stations" style={{ ...table, width: '100%', tableLayout: 'fixed' }}>
        <tbody>
          <tr>
            {groups.map((g, i) => (
              <td key={i} style={cell}>
                {g.name.trim() && <p style={{ fontWeight: 700, margin: '0 0 4px' }}>{g.name}</p>}
                <div className="sheet-notes" dangerouslySetInnerHTML={clean(g.notes_html)} />
                {g.members.length > 0 && (
                  <p style={{ margin: '6px 0 0' }}>
                    {g.members.map((m, j) => (
                      <span key={j}>
                        {j > 0 && ', '}
                        {member(m)}
                      </span>
                    ))}
                  </p>
                )}
              </td>
            ))}
          </tr>
        </tbody>
      </table>
    );
  }

  // Squads: one column per group, one player per row.
  const rows = Math.max(...groups.map((g) => g.members.length));
  if (rows === 0 && !hasNames) return null;
  return (
    <table className="sheet-squads" style={table}>
      {hasNames && (
        <thead>
          <tr>
            {groups.map((g, i) => (
              <th key={i} style={{ ...cell, minWidth: 96 }}>
                {g.name}
              </th>
            ))}
          </tr>
        </thead>
      )}
      <tbody>
        {Array.from({ length: rows }, (_, r) => (
          <tr key={r}>
            {groups.map((g, i) => (
              <td key={i} style={{ ...cell, minWidth: 96 }}>
                {g.members[r] ? member(g.members[r]) : ''}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function CoachBlock({ item, nameOf }: { item: Item; nameOf: (id: number) => string }) {
  const notes = item.player_notes.filter((n) => n.note.trim() && nameOf(n.player_id));
  if (isBlankHtml(item.coach_notes_html) && notes.length === 0) return null;
  return (
    <div className="sheet-coach" style={{ borderLeft: '3px solid #999', padding: '2px 0 2px 10px', margin: '8px 0' }}>
      <p style={{ margin: 0, fontSize: '8.5pt', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.04em', color: '#666' }}>
        Coach only
      </p>
      {!isBlankHtml(item.coach_notes_html) && <div className="sheet-notes" dangerouslySetInnerHTML={clean(item.coach_notes_html)} />}
      {notes.length > 0 && (
        <ul style={{ margin: '4px 0' }}>
          {notes.map((n, i) => (
            <li key={i}>
              <strong>{nameOf(n.player_id)}:</strong> {n.note}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
