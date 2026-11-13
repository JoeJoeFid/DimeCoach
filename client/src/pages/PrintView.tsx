import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api } from '../api';
import { useApp } from '../App';
import type { Group, Item, Plan, Play, Player } from '../types';
import { SITUATIONS, availablePlayers, playingTime, segmentsOf, subsOf } from '../game';
import { sportKind } from '../sports';
import { fmtClock, parseClock } from '../util';
import { PlaySteps } from '../components/PlayDiagram';
import { SheetLinks } from '../components/ItemMedia';
import { imageUrl } from '../components/ItemImages';
import { clean, fmtDateSheet, isBlankHtml, schedule, slotGroups, slotLabel } from '../util';

/** Who the sheet is for. Coach-only content appears in 'coach' and nowhere else. */
type Audience = 'simple' | 'notes' | 'coach';
const AUDIENCES: { id: Audience; label: string; hint: string }[] = [
  { id: 'simple', label: 'Simple', hint: 'Times and titles only.' },
  { id: 'notes', label: 'With notes', hint: 'Adds notes and groups. Coach-only notes stay hidden.' },
  { id: 'coach', label: 'Coach copy', hint: 'Everything, including coach-only and player notes. Do not send to parents.' },
];

/** Whether attached plays are printed: not at all, every step, or only the step numbers typed in. */
type PlayMode = 'hide' | 'all' | 'some';
const PLAY_MODES: { id: PlayMode; label: string }[] = [
  { id: 'hide', label: 'Hide' },
  { id: 'all', label: 'All steps' },
  { id: 'some', label: 'Choose steps' },
];
/** "1, 3-5" as the numbers 1, 3, 4, 5. Anything that is not a number or a range is ignored. */
function stepNumbers(text: string) {
  const out = new Set<number>();
  for (const part of text.split(/[,;\s]+/)) {
    const m = /^(\d+)(?:-(\d+))?$/.exec(part);
    if (!m) continue;
    const from = Number(m[1]);
    const to = Math.min(Number(m[2] ?? m[1]), from + 99);
    for (let n = from; n <= to; n++) out.add(n);
  }
  return out;
}

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
  const [playMode, setPlayMode] = useState<PlayMode>('all');
  const [stepText, setStepText] = useState('');
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
  const hasPlays = plan.items.some((it) => (it.play_ids || []).length > 0);
  const chosen = stepNumbers(stepText);
  // With nothing usable typed yet, every step still shows.
  const only = playMode === 'some' && chosen.size > 0 ? chosen : undefined;

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

  /** Everything printed under an item's title: its details for this version of the sheet. `narrow` is one column of a shared time slot. */
  const itemBody = (it: Item, narrow = false) => (
    <>
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
          {(playMode === 'hide' ? [] : it.play_ids || [])
            .map((pid) => plays.find((p) => p.id === pid))
            .filter((p): p is Play => !!p && (!only || p.frames.some((_, n) => only.has(n + 1))))
            .map((p) => (
              <div key={p.id} className="sheet-play" style={{ margin: '10px 0' }}>
                <p style={{ fontWeight: 700, margin: '0 0 4px' }}>{p.name}</p>
                <PlaySteps play={p} columns={narrow ? 2 : Math.max(3, Math.min(4, p.frames.length))} only={only} />
              </div>
            ))}
          <SheetLinks links={it.links || []} videos={(it.videos || []).length} />
          <Groups groups={it.groups} nameOf={nameOf} />
        </>
      )}
      {audience === 'coach' && <CoachBlock item={it} nameOf={nameOf} />}
    </>
  );

  return (
    <div className="print-page">
      <div className="print-panel no-print">
        <div className="print-top">
          <Link className="btn" to={`/plans/${plan.id}`}>
            ← Back to editor
          </Link>
          <h1>Print preview</h1>
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
        <div className="print-options">
          <div className="print-option">
            <span className="field-label">Version</span>
            <div className="seg" role="group" aria-label="Sheet version">
              {AUDIENCES.map((a) => (
                <button key={a.id} className={audience === a.id ? 'on' : ''} aria-pressed={audience === a.id} title={a.hint} onClick={() => setAudience(a.id)}>
                  {a.label}
                </button>
              ))}
            </div>
          </div>
          {hasPlays && (
            <div className="print-option">
              <span className="field-label">Plays</span>
              <div className="print-plays">
                <div className="seg" role="group" aria-label="Plays on the sheet">
                  {PLAY_MODES.map((m) => (
                    <button key={m.id} className={playMode === m.id ? 'on' : ''} aria-pressed={playMode === m.id} disabled={audience === 'simple'} onClick={() => setPlayMode(m.id)}>
                      {m.label}
                    </button>
                  ))}
                </div>
                {playMode === 'some' && audience !== 'simple' && (
                  <input className="input" autoFocus aria-label="Step numbers to print" placeholder="Such as 1, 3-4" value={stepText} onChange={(e) => setStepText(e.target.value)} />
                )}
              </div>
            </div>
          )}
          <div className="print-option">
            <span className="field-label">Also show</span>
            <div className="chips">
              {!isHomework && (
                <button type="button" className={`chip toggle ${showBreaks ? 'on' : ''}`} aria-pressed={showBreaks} onClick={() => setShowBreaks(!showBreaks)}>
                  Breaks
                </button>
              )}
              <button type="button" className={`chip toggle ${showTags ? 'on' : ''}`} aria-pressed={showTags} onClick={() => setShowTags(!showTags)}>
                Categories
              </button>
            </div>
          </div>
        </div>
        <p className="print-hint" role="status">
          {copied ||
            [
              AUDIENCES.find((a) => a.id === audience)!.hint,
              hasPlays && audience === 'simple' && 'Plays are left off the simple version.',
              hasPlays && audience !== 'simple' && playMode === 'some' && (only ? 'The same step numbers are used for every play. A play with none of them is left off.' : 'Type the step numbers to print. Until then every step shows.'),
            ]
              .filter(Boolean)
              .join(' ')}
        </p>
      </div>

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

        {plan.is_game && !isHomework && <GameSheet plan={plan} players={players} plays={plays} audience={audience} sport={app.sports.find((s) => s.id === team?.sport_id)?.name} showPlays={playMode !== 'hide'} only={only} />}
        {(plan.is_game && !isHomework ? [] : slotGroups(plan.items)).map((group) => {
          const i = group[0];
          const it = plan.items[i];
          if (it.kind === 'break') {
            if (!showBreaks || isHomework) return null;
            return (
              <p key={it.key} className="sheet-break" style={{ color: '#666', margin: '10px 0' }}>
                ({slotLabel(slots[i])}) {it.title || 'Break'}
              </p>
            );
          }
          if (group.length > 1) {
            // Drills run at the same time: one heading with the shared time, then a column for each.
            const longest = Math.max(...group.map((n) => plan.items[n].duration_min || 0));
            return (
              <section key={it.key} className="sheet-item sheet-split">
                <h2 style={{ fontSize: '19pt', margin: '18px 0 2px', lineHeight: 1.2 }}>
                  {isHomework ? '☐ ' : `(${slotLabel(slots[i])}) `}
                  {group.length} groups at the same time
                </h2>
                <p style={{ margin: '0 0 6px', color: '#666', fontSize: '9.5pt' }}>The team splits up. Each group does one of these.</p>
                <table className="sheet-split-table" style={{ ...table, width: '100%', tableLayout: 'fixed' }}>
                  <tbody>
                    <tr>
                      {group.map((n, k) => {
                        const each = plan.items[n];
                        return (
                          <td key={each.key} style={{ ...cell, width: `${100 / group.length}%`, padding: '8px 12px 10px' }}>
                            <p style={{ margin: '0 0 2px', color: '#666', fontSize: '8.5pt', fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase' }}>Group {k + 1}</p>
                            <h3 style={{ fontSize: '14pt', margin: '0 0 6px', lineHeight: 1.2 }}>
                              {each.title || 'Untitled'}
                              {!isHomework && (each.duration_min || 0) < longest && <span style={{ color: '#666', fontSize: '9.5pt', fontWeight: 400 }}> · {each.duration_min} min</span>}
                            </h3>
                            {itemBody(each, true)}
                          </td>
                        );
                      })}
                    </tr>
                  </tbody>
                </table>
              </section>
            );
          }
          return (
            <section key={it.key} className="sheet-item">
              <h2 style={{ fontSize: '19pt', margin: '18px 0 8px', lineHeight: 1.2 }}>
                {isHomework ? '☐ ' : `(${slotLabel(slots[i])}) `}
                {it.title || 'Untitled'}
              </h2>
              {itemBody(it)}
            </section>
          );
        })}
      </div>
    </div>
  );
}

/**
 * A game on paper. The simple version is for parents: who, when, where, what to wear and bring.
 * The others are the bench card: keys, lineup and playing time, the play sheet, matchups, warm-up.
 * Scouting notes and the result only go on the coach copy.
 */
function GameSheet({ plan, players, plays, audience, sport, showPlays, only }: { plan: Plan; players: Player[]; plays: Play[]; audience: Audience; sport: string | undefined; showPlays: boolean; only?: Set<number> }) {
  const g = plan.game || {};
  const kind = sportKind(sport);
  const subs = subsOf(g, kind);
  const segments = segmentsOf(subs);
  const lineup = segments.map((_, i) => g.lineup?.[i] ?? []);
  const here = availablePlayers(players, g);
  const nameOf = (id: number) => players.find((p) => p.id === id)?.name || '';
  const h3: CSSProperties = { fontSize: '13pt', margin: '16px 0 6px', lineHeight: 1.2 };
  const small: CSSProperties = { color: '#666', fontSize: '9.5pt' };
  const facts = [
    g.opponent && ['Opponent', `${g.side === 'away' ? 'at ' : g.side === 'home' ? 'vs. ' : ''}${g.opponent}${g.side === 'neutral' ? ' (neutral site)' : g.side === 'home' ? ' (home)' : g.side === 'away' ? ' (away)' : ''}`],
    plan.start_time && ['Starts', fmtClock(parseClock(plan.start_time))],
    g.arrive && ['Arrive by', fmtClock(parseClock(g.arrive))],
    plan.location && ['Where', plan.location],
    g.uniform && ['Uniform', g.uniform],
    g.bring && ['Bring', g.bring],
  ].filter(Boolean) as [string, string][];
  const keys = [...(g.keys?.offense || []), ...(g.keys?.defense || []), g.keys?.focus || ''].some((k) => k.trim());
  const anyLineup = lineup.some((s) => s.length > 0);
  const batting = (g.batting || []).filter((id) => nameOf(id));
  const sheet = SITUATIONS.map((s) => ({ situation: s, list: (g.plays?.find((p) => p.situation === s)?.play_ids ?? []).map((id) => plays.find((p) => p.id === id)).filter((p): p is Play => !!p) })).filter((s) => s.list.length > 0);
  const out = players.filter((p) => p.active && (g.availability || {})[String(p.id)] === 'out');
  const result = g.result;
  return (
    <div className="game-sheet">
      {facts.length > 0 && (
        <table style={{ ...table, margin: '0 0 12px' }}>
          <tbody>
            {facts.map(([label, value]) => (
              <tr key={label}>
                <td style={{ ...cell, fontWeight: 700, whiteSpace: 'nowrap' }}>{label}</td>
                <td style={cell}>{value}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {audience !== 'simple' && (
        <>
          {keys && (
            <>
              <h3 style={h3}>Keys to the game</h3>
              {g.keys?.focus?.trim() && <p style={{ fontSize: '14pt', fontWeight: 700, margin: '0 0 8px' }}>{g.keys.focus.trim()}</p>}
              <table style={{ ...table, width: '100%', tableLayout: 'fixed' }}>
                <tbody>
                  <tr>
                    {(['offense', 'defense'] as const).map((side) => (
                      <td key={side} style={{ ...cell, width: '50%' }}>
                        <p style={{ ...small, fontWeight: 700, margin: '0 0 4px', textTransform: 'uppercase', letterSpacing: '0.06em' }}>{side === 'offense' ? 'On offense' : 'On defense'}</p>
                        <ol style={{ margin: 0, paddingLeft: 20, fontSize: '12pt' }}>
                          {(g.keys?.[side] || [])
                            .filter((k) => k.trim())
                            .map((k, i) => (
                              <li key={i}>{k}</li>
                            ))}
                        </ol>
                      </td>
                    ))}
                  </tr>
                </tbody>
              </table>
            </>
          )}
          {anyLineup && (
            <>
              <h3 style={h3}>Lineup and playing time</h3>
              <table style={{ ...table, fontSize: '10pt' }}>
                <thead>
                  <tr>
                    <th style={cell}>Player</th>
                    {segments.map((s, i) => (
                      <th key={i} style={{ ...cell, textAlign: 'center', padding: '6px 6px' }}>
                        {s.label}
                      </th>
                    ))}
                    <th style={cell}>Plays</th>
                  </tr>
                </thead>
                <tbody>
                  {here.map((p) => (
                    <tr key={p.id}>
                      <td style={{ ...cell, whiteSpace: 'nowrap' }}>
                        {p.number ? `${p.number} ` : ''}
                        {p.name}
                        {(g.availability || {})[String(p.id)] === 'late' ? ' (late)' : ''}
                      </td>
                      {segments.map((_, i) => (
                        <td key={i} style={{ ...cell, textAlign: 'center', padding: '6px 6px' }}>
                          {lineup[i].includes(p.id) ? '●' : ''}
                        </td>
                      ))}
                      <td style={{ ...cell, whiteSpace: 'nowrap' }}>{playingTime(p.id, lineup, segments, subs).text}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {out.length > 0 && <p style={small}>Out: {out.map((p) => p.name).join(', ')}</p>}
            </>
          )}
          {batting.length > 0 && (
            <>
              <h3 style={h3}>Batting order</h3>
              <ol style={{ margin: '0 0 8px', paddingLeft: 22 }}>
                {batting.map((id) => (
                  <li key={id}>
                    {nameOf(id)}
                    {(g.positions || {})[String(id)] ? ` (${(g.positions || {})[String(id)]})` : ''}
                  </li>
                ))}
              </ol>
            </>
          )}
          {(g.matchups || []).length > 0 && (
            <>
              <h3 style={h3}>Matchups</h3>
              <table style={table}>
                <tbody>
                  {(g.matchups || []).map((m, i) => (
                    <tr key={i}>
                      <td style={{ ...cell, fontWeight: 700 }}>{nameOf(m.player_id)}</td>
                      <td style={cell}>{m.opponent}</td>
                      <td style={cell}>{m.note}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          )}
          {(g.warmup || []).length > 0 && (
            <>
              <h3 style={h3}>Warm-up</h3>
              <ul style={{ margin: '0 0 8px', paddingLeft: 20 }}>
                {(g.warmup || []).map((w, i) => (
                  <li key={i}>
                    {w.title || 'Warm-up'} <span style={small}>{w.minutes} min</span>
                  </li>
                ))}
              </ul>
            </>
          )}
          {sheet.length > 0 && (
            <>
              <h3 style={h3}>Play sheet</h3>
              {sheet.map((s) => (
                <div key={s.situation} style={{ margin: '0 0 10px' }}>
                  <p style={{ ...small, fontWeight: 700, margin: '0 0 4px', textTransform: 'uppercase', letterSpacing: '0.06em' }}>{s.situation}</p>
                  {s.list.map((p) => (
                    <div key={p.id} className="sheet-play" style={{ margin: '6px 0 10px' }}>
                      <p style={{ fontWeight: 700, margin: '0 0 4px' }}>{p.name}</p>
                      {showPlays && <PlaySteps play={p} columns={Math.max(3, Math.min(4, p.frames.length))} only={only} />}
                    </div>
                  ))}
                </div>
              ))}
            </>
          )}
        </>
      )}
      {audience === 'coach' && (
        <>
          {(g.scouting || '').trim() && (
            <div className="sheet-coach" style={{ borderLeft: '3px solid #999', padding: '2px 0 2px 10px', margin: '12px 0' }}>
              <p style={{ fontWeight: 700, margin: '0 0 4px' }}>Scouting notes</p>
              <p style={{ margin: 0, whiteSpace: 'pre-wrap' }}>{g.scouting}</p>
            </div>
          )}
          {result && (result.us || result.them || result.went_well || result.work_on) && (
            <div className="sheet-coach" style={{ borderLeft: '3px solid #999', padding: '2px 0 2px 10px', margin: '12px 0' }}>
              <p style={{ fontWeight: 700, margin: '0 0 4px' }}>
                Result{result.us || result.them ? `: ${result.us || '?'} to ${result.them || '?'}` : ''}
              </p>
              {result.went_well && <p style={{ margin: '0 0 4px', whiteSpace: 'pre-wrap' }}>Went well: {result.went_well}</p>}
              {result.work_on && <p style={{ margin: 0, whiteSpace: 'pre-wrap' }}>To work on: {result.work_on}</p>}
            </div>
          )}
        </>
      )}
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
