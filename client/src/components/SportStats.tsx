// Stats for the sports that are not basketball: a table of players, a game's box score, and a
// season looked at three ways. All of it is laid out from what the sport says its numbers are
// (../sportScoring.ts), so baseball reads as baseball and volleyball as volleyball.
import { useState } from 'react';
import type { Scoresheet } from '../scoring';
import { sportScore, statText, sumTallies, tallyOf, type SportDef, type SportEvent, type SportStat, type Tally } from '../sportScoring';
import { fmtDateShort } from '../util';
import { winLinks } from '../wins';
import { WinTable } from './WhatWins';

const playsOf = (g: { events: unknown }) => g.events as SportEvent[];
/** What a stat sorts by: nothing to go on sorts last. */
const sortBy = (stat: SportStat, t: Tally, games?: number) => {
  const x = stat.value(t);
  return x === null ? -Infinity : stat.ratio || !games ? x : x / Math.max(1, games);
};

/**
 * A table of this sport's numbers: one row for each name, and a row of totals when asked for. A
 * column that is nothing in every row was not tracked, and is left out. With `sortable`, pressing
 * a heading puts the rows in order by it. With `average`, numbers that add up are per game.
 */
export function SportStatTable({
  def,
  rows,
  total,
  first = 'Player',
  extra,
  sortable,
  average,
}: {
  def: SportDef;
  rows: { key: string | number; name: string; tally: Tally; extra?: string | number }[];
  total?: { name: string; tally: Tally; games?: number };
  first?: string;
  /** A column before the numbers, such as games played. */
  extra?: string;
  sortable?: boolean;
  average?: boolean;
}) {
  const [sort, setSort] = useState<{ key: string; down: boolean } | null>(null);
  const all = [...rows.map((r) => r.tally), ...(total ? [total.tally] : [])];
  const cols = def.columns.filter((c) => all.some((t) => !!c.value(t)));
  const games = (r: { extra?: string | number }) => (average ? Number(r.extra) || 1 : undefined);
  const ordered = sort
    ? [...rows].sort((a, b) => {
        const col = cols.find((c) => c.key === sort.key);
        const way = sort.key === 'name' ? a.name.localeCompare(b.name) : sort.key === 'extra' ? Number(a.extra) - Number(b.extra) : col ? sortBy(col, a.tally, games(a)) - sortBy(col, b.tally, games(b)) : 0;
        return sort.down ? -way : way;
      })
    : rows;
  // Numbers start with the most at the top; names start at A.
  const press = (key: string) => setSort(sort?.key === key ? { key, down: !sort.down } : { key, down: key !== 'name' });
  const head = (key: string, label: string, title?: string) =>
    sortable ? (
      <th key={key} aria-sort={sort?.key === key ? (sort.down ? 'descending' : 'ascending') : undefined}>
        <button type="button" className={`sp-sort ${sort?.key === key ? 'on' : ''}`} onClick={() => press(key)} title={title ? `${title}. Press to sort.` : `Sort by ${label}`}>
          {label}
          <span aria-hidden="true">{sort?.key === key ? (sort.down ? ' ▾' : ' ▴') : ''}</span>
        </button>
      </th>
    ) : (
      <th key={key} title={title}>
        {label}
      </th>
    );
  if (cols.length === 0) return <p className="muted small">Nothing has been recorded for a player yet.</p>;
  return (
    <div className="table-scroll">
      <table className={`table sp-table ${sortable ? 'cross' : ''}`}>
        <thead>
          <tr>
            {head('name', first)}
            {extra && head('extra', extra)}
            {cols.map((c) => head(c.key, c.label, c.name))}
          </tr>
        </thead>
        <tbody>
          {ordered.map((r) => (
            <tr key={r.key}>
              <td>{r.name}</td>
              {extra && <td>{r.extra}</td>}
              {cols.map((c) => (
                <td key={c.key}>{statText(c, r.tally, games(r))}</td>
              ))}
            </tr>
          ))}
        </tbody>
        {total && (
          <tfoot>
            <tr>
              <td>{total.name}</td>
              {extra && <td>{average ? total.games : ''}</td>}
              {cols.map((c) => (
                <td key={c.key}>{statText(c, total.tally, average ? total.games || 1 : undefined)}</td>
              ))}
            </tr>
          </tfoot>
        )}
      </table>
    </div>
  );
}

/** The score part by part: innings, quarters or sets across, the two teams down. */
export function LineScore({ def, events, state, usName, themName }: { def: SportDef; events: SportEvent[]; state: { period: number; status: 'live' | 'final' }; usName: string; themName: string }) {
  const score = sportScore(def, events, state);
  return (
    <table className="sp-periods" aria-label={`Score by ${def.period.toLowerCase()}`}>
      <thead>
        <tr>
          <th />
          {score.parts.map((_, i) => (
            <th key={i}>{def.periodName(i + 1).replace(/^(Inn|Set) /, '')}</th>
          ))}
          <th>{def.sets ? 'Sets' : 'T'}</th>
        </tr>
      </thead>
      <tbody>
        {(['us', 'them'] as const).map((side) => (
          <tr key={side}>
            <th>{side === 'us' ? usName : themName}</th>
            {score.parts.map((p, i) => (
              <td key={i}>{p[side]}</td>
            ))}
            <td>
              <b>{score[side]}</b>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/** A game's box score: the score part by part, and each player's line with the team's totals. */
export function SportBox({ def, events, players, usName, themName, state }: { def: SportDef; events: Scoresheet['events']; players: { id: number; name: string; number: string }[]; usName: string; themName: string; state: { period: number; status: 'live' | 'final' } }) {
  const list = events as unknown as SportEvent[];
  const us = tallyOf(list, 'us');
  const rows = players.filter((p) => us.players.has(p.id)).map((p) => ({ key: p.id, name: `${p.number ? `#${p.number} ` : ''}${p.name}`, tally: us.players.get(p.id)! }));
  return (
    <>
      <div className="card">
        <h2>Score by {def.period.toLowerCase()}</h2>
        <LineScore def={def} events={list} state={state} usName={usName} themName={themName} />
      </div>
      <div className="card">
        <h2>{usName}</h2>
        <SportStatTable def={def} rows={rows} total={{ name: 'Team', tally: us.total }} />
      </div>
    </>
  );
}

type Show = 'table' | 'games' | 'wins';
/**
 * A season in this sport, from the games chosen: every player's numbers added up, the team's
 * numbers game by game, and which of them move with winning.
 */
export function SportSeason({ def, games, nameOf }: { def: SportDef; games: Scoresheet[]; nameOf: (id: number) => string }) {
  const [show, setShow] = useState<Show>('table');
  const [average, setAverage] = useState(false);
  const each = games.map((g) => ({ g, us: tallyOf(playsOf(g), 'us'), them: tallyOf(playsOf(g), 'them') }));
  const season = new Map<number, { games: number; tallies: Tally[] }>();
  for (const { us } of each) {
    for (const [id, t] of us.players) {
      const had = season.get(id) ?? { games: 0, tallies: [] };
      season.set(id, { games: had.games + 1, tallies: [...had.tallies, t] });
    }
  }
  const lead = def.columns[0];
  const rows = [...season.entries()]
    .map(([id, s]) => ({ key: id, name: nameOf(id), tally: sumTallies(s.tallies), extra: s.games }))
    .sort((a, b) => (lead.value(b.tally) ?? 0) - (lead.value(a.tally) ?? 0));
  const count = `${games.length} ${games.length === 1 ? 'game' : 'games'}`;
  // A game with a score and nothing else has no stats to weigh.
  const tracked = each.filter((x) => Object.keys(x.us.total.n).length > 0);
  return (
    <>
      <div className="st-show">
        <div className="seg" role="group" aria-label="What to look at">
          {(
            [
              ['table', 'Summary'],
              ['games', 'Game by game'],
              ['wins', 'What wins'],
            ] as const
          ).map(([id, label]) => (
            <button key={id} type="button" className={show === id ? 'on' : ''} aria-pressed={show === id} onClick={() => setShow(id)}>
              {label}
            </button>
          ))}
        </div>
      </div>
      {games.length === 0 ? (
        <p className="muted">Choose at least one game above.</p>
      ) : show === 'table' ? (
        <div className="card">
          <div className="st-sum-head">
            <h2>
              Summary <span className="muted small">{count} · press a heading to sort</span>
            </h2>
            <div className="seg" role="group" aria-label="Totals or averages">
              <button type="button" className={!average ? 'on' : ''} aria-pressed={!average} onClick={() => setAverage(false)}>
                Totals
              </button>
              <button type="button" className={average ? 'on' : ''} aria-pressed={average} onClick={() => setAverage(true)}>
                Per game
              </button>
            </div>
          </div>
          {rows.length === 0 && <p className="muted small">These games have a score and nothing per player.</p>}
          <SportStatTable def={def} sortable average={average} rows={rows} total={{ name: 'Team', tally: sumTallies(each.map((x) => x.us.total)), games: games.length }} extra="Games" />
        </div>
      ) : show === 'games' ? (
        <div className="card">
          <h2>
            Game by game <span className="muted small">{count} · the team's numbers in each</span>
          </h2>
          <SportStatTable
            def={def}
            sortable
            first="Game"
            extra="Score"
            rows={[...each]
              .sort((a, b) => a.g.date.localeCompare(b.g.date) || a.g.id - b.g.id)
              .map(({ g, us }) => ({ key: g.id, name: `${fmtDateShort(g.date)} · ${g.opponent ? `vs. ${g.opponent}` : g.title || 'Game'}`, tally: us.total, extra: `${g.us}–${g.them}` }))}
          />
        </div>
      ) : (
        <div className="card">
          <h2>
            What wins <span className="muted small">which stats move with the result, over the games chosen above</span>
          </h2>
          {tracked.length === 0 ? (
            <p className="muted">None of these games has stats recorded, only a score.</p>
          ) : (
            <WinTable
              games={tracked.length}
              {...winLinks(
                tracked.map(({ g, us, them }) => {
                  // A game won by sets is weighed by its points, which say how close it was.
                  const by = def.sets ? sportScore({ ...def, sets: false }, playsOf(g), g.state) : g;
                  return { us: us.total, them: them.total, scoreUs: by.us, scoreThem: by.them };
                }),
                def.wins,
              )}
              note={`${def.sets ? 'Points' : def.kind === 'baseball' ? 'Runs' : 'Points'} are left out because the margin is made of them.`}
            />
          )}
        </div>
      )}
    </>
  );
}
