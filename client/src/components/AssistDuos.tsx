// Who sets up whom: every pair of players with an assist between them, the pairs that connect
// most at the top, and under each pair how many went each way.
import { assistPairs, type GameEvent } from '../scoring';

export default function AssistDuos({ games, nameOf }: { games: { events: GameEvent[] }[]; nameOf: (playerId: number) => string }) {
  const ways = new Map<string, number>();
  let loose = 0;
  for (const g of games) {
    const found = assistPairs(g.events);
    loose += found.loose;
    for (const p of found.pairs) ways.set(`${p.from}>${p.to}`, (ways.get(`${p.from}>${p.to}`) ?? 0) + 1);
  }
  // A duo is the two players whichever way the pass went.
  const duos = new Map<string, { a: number; b: number; ab: number; ba: number }>();
  for (const [key, n] of ways) {
    const [from, to] = key.split('>').map(Number);
    const [a, b] = from < to ? [from, to] : [to, from];
    const d = duos.get(`${a}-${b}`) ?? { a, b, ab: 0, ba: 0 };
    if (from === a) d.ab += n;
    else d.ba += n;
    duos.set(`${a}-${b}`, d);
  }
  const list = [...duos.values()]
    // The one who passes more is named first.
    .map((d) => (d.ba > d.ab ? { a: d.b, b: d.a, ab: d.ba, ba: d.ab } : d))
    .sort((x, y) => y.ab + y.ba - (x.ab + x.ba) || y.ab - x.ab);
  const most = Math.max(1, ...list.map((d) => d.ab + d.ba));
  const first = (id: number) => nameOf(id).replace(/^#\d+\s*/, '').split(' ')[0];
  if (list.length === 0)
    return <p className="muted small duo-none">No assists with a known scorer yet. After a made shot the pad asks who assisted: those are the ones counted here.</p>;
  return (
    <div className="duo">
      <ol className="duo-list">
        {list.map((d) => (
          <li key={`${d.a}-${d.b}`}>
            <span className="duo-names">
              <strong>{nameOf(d.a)}</strong> <span className="muted">and</span> <strong>{nameOf(d.b)}</strong>
            </span>
            <span className="duo-count">{d.ab + d.ba}</span>
            <span className="duo-bar" aria-hidden="true">
              <i style={{ width: `${((d.ab + d.ba) / most) * 100}%` }} />
            </span>
            <span className="muted small duo-ways">
              {first(d.a)} to {first(d.b)}: {d.ab}
              {d.ba > 0 && ` · ${first(d.b)} to ${first(d.a)}: ${d.ba}`}
            </span>
          </li>
        ))}
      </ol>
      {loose > 0 && (
        <p className="muted small">
          {loose === 1 ? '1 more assist has' : `${loose} more assists have`} no scorer to pair with: put in with the AST button by itself, or left to assign later.
        </p>
      )}
    </div>
  );
}
