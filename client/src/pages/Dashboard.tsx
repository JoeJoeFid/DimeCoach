import PageTitle from '../components/PageTitle';
import { useEffect, useMemo, useRef, useState, type MouseEvent, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api';
import { useApp } from '../App';
import type { Plan, Tag } from '../types';
import PracticeTimeline from '../components/PracticeTimeline';
import { HEAT_BASE, HEAT_PRESETS, PERIODS, SCOPES, UNTAGGED, heatRamp, fmtDateShort, periodBounds, scopeOf, targetFor, type Period, type TargetScope, fmtDateTiny, fmtDuration, parseClock, planMinutes, todayISO } from '../util';

const PERIOD_KEY = 'practiceplan.dashboardPeriod';
/** A category counts as neglected after this many practices in a row without it. */
const NEGLECT_AFTER = 3;
/** Within this many points of target counts as on target. */
const ON_TARGET_WITHIN = 3;
/** Sequential blue ramp, light to dark: more minutes is darker. */
const HEAT_STEPS = 5;

interface Tip {
  x: number;
  y: number;
  content: ReactNode;
}

const nowMinutes = () => {
  const d = new Date();
  return d.getHours() * 60 + d.getMinutes();
};

export default function Dashboard() {
  const { team, sportTags } = useApp();
  const [plans, setPlans] = useState<Plan[] | null>(null);
  const [homeworkCount, setHomeworkCount] = useState(0);
  const [error, setError] = useState('');
  const [period, setPeriodState] = useState<Period>(() => {
    const saved = localStorage.getItem(PERIOD_KEY) as Period | null;
    return PERIODS.some((p) => p.id === saved) ? saved! : 'season';
  });
  const setPeriod = (p: Period) => {
    localStorage.setItem(PERIOD_KEY, p);
    setPeriodState(p);
  };
  const phrase = PERIODS.find((p) => p.id === period)!.phrase;
  const scope = scopeOf(period);
  const scopeInfo = SCOPES.find((s) => s.id === scope)!;
  const [editTargets, setEditTargets] = useState(false);
  // The viewer's own base color, shared by the category history and the category bars.
  const { user, refreshUser } = useApp();
  const [base, setBase] = useState(user.prefs.heat_color || HEAT_BASE);
  const saveTimer = useRef<number | undefined>(undefined);
  const chooseColor = (color: string) => {
    setBase(color);
    // A color picker fires on every nudge, so save once it settles.
    window.clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(() => {
      api.savePrefs({ heat_color: color === HEAT_BASE ? null : color }).then(refreshUser).catch(() => {});
    }, 500);
  };
  const rampVars = useMemo(() => {
    const ramp = heatRamp(base);
    const vars: Record<string, string> = {};
    ramp.light.forEach((c, i) => (vars[`--hl${i + 1}`] = c));
    ramp.dark.forEach((c, i) => (vars[`--hd${i + 1}`] = c));
    return vars;
  }, [base]);
  const { reload } = useApp();
  const [tip, setTip] = useState<Tip | null>(null);
  const teamId = team!.id;

  useEffect(() => {
    setPlans(null);
    Promise.all([api.plansFull(teamId, 'practice'), api.plans(teamId, 'homework')])
      .then(([p, h]) => {
        setPlans(p);
        setHomeworkCount(h.length);
      })
      .catch((e) => setError((e as Error).message));
  }, [teamId]);

  const today = todayISO();
  // Minutes since midnight, checked once a minute, so today's practice joins the numbers when it ends.
  const [clock, setClock] = useState(nowMinutes);
  useEffect(() => {
    const timer = window.setInterval(() => setClock(nowMinutes()), 60_000);
    return () => window.clearInterval(timer);
  }, []);
  const stats = useMemo(() => {
    if (!plans) return null;
    const tagIds = new Set(sportTags.map((t) => t.id));
    // Game plans are left out: these numbers are about what was trained in practice.
    // Plans with nothing in them are left out too: a blank plan is not a practice that happened.
    const dated = plans.filter((p) => p.date && !p.is_game && p.items.some((i) => i.kind === 'item')).sort((a, b) => a.date.localeCompare(b.date) || a.id - b.id);
    const bounds = periodBounds(period, today);
    // Today's practice only counts once it is over: after its last item ends.
    const over = (p: Plan) => {
      if (p.date !== today) return p.date < today;
      const mins = planMinutes(p);
      return clock >= parseClock(p.start_time) + mins.work + mins.breaks;
    };
    const past = dated.filter(over);
    const done = period === 'last' ? past.slice(-1) : past.filter((p) => p.date >= bounds.from && p.date <= bounds.to);

    const perPlan = done.map((p) => ({ plan: p, mins: planMinutes(p, tagIds) }));
    // Practices that are planned but have not happened yet. They are shown in the history, never counted in the numbers.
    const upcoming = dated.filter((p) => !over(p)).slice(0, 6).map((p) => ({ plan: p, mins: planMinutes(p, tagIds) }));
    const totals = new Map<number, number>();
    let work = 0;
    let breaks = 0;
    for (const { mins } of perPlan) {
      work += mins.work;
      breaks += mins.breaks;
      for (const [t, m] of mins.byTag) totals.set(t, (totals.get(t) || 0) + m);
    }
    const untagged = totals.get(UNTAGGED) || 0;

    const rows = sportTags.map((tag) => {
      const minutes = totals.get(tag.id) || 0;
      // The share of practice time that worked on this category. Shares can overlap, so they may total over 100%.
      const share = work > 0 ? (minutes / work) * 100 : 0;
      let lastIndex = -1;
      perPlan.forEach(({ mins }, i) => {
        if ((mins.byTag.get(tag.id) || 0) > 0) lastIndex = i;
      });
      return {
        tag,
        minutes,
        share,
        target: targetFor(tag, scope),
        gap: targetFor(tag, scope) == null ? null : share - targetFor(tag, scope)!,
        lastDate: lastIndex >= 0 ? perPlan[lastIndex].plan.date : null,
        practicesSince: lastIndex >= 0 ? perPlan.length - 1 - lastIndex : perPlan.length,
      };
    });
    const neglected = rows
      .filter((r) => perPlan.length > 0 && (r.lastDate === null || r.practicesSince >= NEGLECT_AFTER))
      .sort((a, b) => b.practicesSince - a.practicesSince);

    const drills = new Map<string, { count: number; minutes: number }>();
    for (const { plan } of perPlan)
      for (const it of plan.items)
        if (it.kind === 'item' && it.title.trim()) {
          const d = drills.get(it.title.trim()) || { count: 0, minutes: 0 };
          drills.set(it.title.trim(), { count: d.count + 1, minutes: d.minutes + it.duration_min });
        }
    const topDrills = [...drills.entries()].sort((a, b) => b[1].minutes - a[1].minutes).slice(0, 5);

    return { perPlan, upcoming, rows, neglected, work, breaks, untagged, topDrills };
  }, [plans, sportTags, period, scope, today, clock]);

  const showTip = (content: ReactNode) => ({
    onMouseEnter: (e: MouseEvent) => setTip({ x: e.clientX, y: e.clientY, content }),
    onMouseMove: (e: MouseEvent) => setTip({ x: e.clientX, y: e.clientY, content }),
    onMouseLeave: () => setTip(null),
  });

  if (error) return <div className="page error">{error}</div>;
  if (!stats) return <div className="page muted">Loading…</div>;
  const n = stats.perPlan.length;
  const withTargets = stats.rows.filter((r) => r.gap !== null);
  const onTarget = withTargets.filter((r) => Math.abs(r.gap!) <= ON_TARGET_WITHIN).length;

  return (
    <div className="page heat-scope" style={rampVars}>
      <div className="page-head">
        <div>
          <PageTitle>Dashboard</PageTitle>
        </div>
        <div className="head-actions">
          <label className="period">
            <span className="field-label">Track over</span>
            <select className="input" value={period} onChange={(e) => setPeriod(e.target.value as Period)}>
              {PERIODS.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.label}
                </option>
              ))}
            </select>
          </label>
          {/* Straight into a new practice, not the list of them. */}
          <Link className="btn primary" to="/practices?new=1">
            Plan a practice
          </Link>
        </div>
      </div>

      <PracticeTimeline plans={plans || []} tags={sportTags} onChanged={() => api.plansFull(teamId, 'practice').then(setPlans, (e) => setError((e as Error).message))} />

      {n === 0 ? (
        <div className="empty">
          <h2>No practices {period === 'season' ? 'yet' : phrase}</h2>
          <p>
            {period === 'season'
              ? 'Once you have run a practice, this page shows where your time went and which categories need attention.'
              : 'Pick a longer period under "Track over" to see where your time went.'}
          </p>
          {/* Straight into a new practice, not the list of them. */}
          <Link className="btn primary" to="/practices?new=1">
            Plan a practice
          </Link>
        </div>
      ) : (
        <>
          <div className="tiles">
            <Tile label="Practices" value={String(n)} sub={`${fmtDateTiny(stats.perPlan[0].plan.date)} to ${fmtDateTiny(stats.perPlan[n - 1].plan.date)}`} />
            <Tile label="Practice time" value={fmtDuration(stats.work)} sub={`plus ${fmtDuration(stats.breaks)} of breaks`} />
            <Tile label="Average practice" value={fmtDuration((stats.work + stats.breaks) / n)} sub={`${Math.round(stats.work / n)} min of work`} />
            <Tile
              label="Categories on target"
              value={withTargets.length ? `${onTarget} of ${withTargets.length}` : 'No targets'}
              sub={withTargets.length ? `within ${ON_TARGET_WITHIN} points of target` : 'Set targets on the Categories page'}
            />
            <Tile label="Need attention" value={String(stats.neglected.length)} sub={`not worked in ${NEGLECT_AFTER}+ practices`} />
          </div>

          <CategoryHistory perPlan={stats.perPlan} upcoming={stats.upcoming} tags={sportTags} showTip={showTip} base={base} onChoose={chooseColor} />

          <div className="dash-grid">
            <section className="card">
              <div className="card-head">
                <h2>Time by category, {phrase}</h2>
                <button className="btn small" aria-pressed={editTargets} onClick={() => setEditTargets(!editTargets)}>
                  {editTargets ? 'Done' : 'Edit targets'}
                </button>
              </div>
              <p className="muted small">
                How much of your practice time worked on each category, across {n === 1 ? 'the 1 practice' : `all ${n} practices`} {phrase}, judged
                against your targets for {scopeInfo.phrase}. An item counts in full toward every category it is tagged with, so the shares can add
                up to more than 100%. The tick marks the target. Breaks and game plans are not counted.
                {editTargets && ` Changes here set the target for ${scopeInfo.phrase} only. Leave a box blank to use the category's default.`}
              </p>
              <ShareBars
                rows={stats.rows}
                showTip={showTip}
                editing={editTargets}
                scope={scope}
                onTarget={async (tag, value) => {
                  // Editing here sets the target for this period only. Blank goes back to the default.
                  const targets = { ...tag.targets };
                  if (value == null) delete targets[scope];
                  else targets[scope] = value;
                  try {
                    await api.updateTag({ ...tag, targets });
                    await reload();
                  } catch (e) {
                    setError((e as Error).message);
                  }
                }}
              />
            </section>

            <section className="card">
              <h2>Needs attention</h2>
              <p className="muted small">Categories you have not worked on in the last {NEGLECT_AFTER} practices.</p>
              {stats.neglected.length === 0 ? (
                <p className="good-line">
                  <span className="status good" aria-hidden="true">
                    ✓
                  </span>{' '}
                  Every category has been worked on recently.
                </p>
              ) : (
                <ul className="attention">
                  {stats.neglected.map((r) => (
                    <li key={r.tag.id}>
                      <span className="status warn" aria-hidden="true">
                        !
                      </span>
                      <span>
                        <strong>{r.tag.name}</strong>
                        <br />
                        <span className="muted small">
                          {r.lastDate
                            ? `Last worked ${fmtDateTiny(r.lastDate)}, ${r.practicesSince} practices ago`
                            : `Not worked on ${phrase}`}
                        </span>
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </div>

          <div className="dash-grid">
            <section className="card">
              <h2>Most used items</h2>
              <table className="table">
                <thead>
                  <tr>
                    <th>Item</th>
                    <th className="num">Times run</th>
                    <th className="num">Minutes</th>
                  </tr>
                </thead>
                <tbody>
                  {stats.topDrills.map(([name, d]) => (
                    <tr key={name}>
                      <td>{name}</td>
                      <td className="num">{d.count}</td>
                      <td className="num">{d.minutes}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>
            <section className="card">
              <h2>Other numbers</h2>
              <table className="table">
                <tbody>
                  <tr>
                    <td>Untagged practice time</td>
                    <td className="num">{fmtDuration(stats.untagged)}</td>
                  </tr>
                  <tr>
                    <td>Share of time spent on breaks</td>
                    <td className="num">{Math.round((stats.breaks / Math.max(1, stats.work + stats.breaks)) * 100)}%</td>
                  </tr>
                  <tr>
                    <td>Categories worked on</td>
                    <td className="num">
                      {stats.rows.filter((r) => r.minutes > 0).length} of {stats.rows.length}
                    </td>
                  </tr>
                  <tr>
                    <td>Homework sheets created</td>
                    <td className="num">{homeworkCount}</td>
                  </tr>
                </tbody>
              </table>
            </section>
          </div>
        </>
      )}

      {tip && (
        <div className="tooltip" style={{ left: Math.min(tip.x + 14, window.innerWidth - 240), top: tip.y + 14 }}>
          {tip.content}
        </div>
      )}
    </div>
  );
}

function Tile({ label, value, sub }: { label: string; value: string; sub: string }) {
  return (
    <div className="tile">
      <div className="tile-label">{label}</div>
      <div className="tile-value">{value}</div>
      <div className="tile-sub">{sub}</div>
    </div>
  );
}

type TipProps = (content: ReactNode) => {
  onMouseEnter: (e: MouseEvent) => void;
  onMouseMove: (e: MouseEvent) => void;
  onMouseLeave: () => void;
};
interface Row {
  tag: Tag;
  minutes: number;
  share: number;
  target: number | null;
  gap: number | null;
}

function TargetInput({ tag, scope, onTarget }: { tag: Tag; scope: TargetScope; onTarget: (tag: Tag, target: number | null) => void }) {
  const current = tag.targets[scope] ?? null;
  const [value, setValue] = useState(current == null ? '' : String(current));
  const commit = () => {
    const next = value.trim() === '' ? null : Math.min(100, Math.max(0, Number(value) || 0));
    if (next !== current) onTarget(tag, next);
  };
  return (
    <input
      className="input target-input"
      type="number"
      min={0}
      max={100}
      aria-label={`Target percent for ${tag.name}`}
      placeholder={tag.target_pct == null ? 'none' : String(tag.target_pct)}
      value={value}
      onChange={(e) => setValue(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
    />
  );
}

function ShareBars({
  rows,
  showTip,
  editing,
  scope,
  onTarget,
}: {
  rows: Row[];
  showTip: TipProps;
  editing: boolean;
  scope: TargetScope;
  onTarget: (tag: Tag, target: number | null) => void;
}) {
  const top = Math.max(10, ...rows.map((r) => Math.max(r.share, r.target || 0)));
  const scale = Math.ceil(top / 10) * 10;
  // The biggest share gets the strongest shade. The faintest shade is skipped: it would vanish against the track.
  const biggest = Math.max(1, ...rows.map((r) => r.share));
  const depth = (share: number) => 2 + Math.min(3, Math.floor((share / biggest) * 4 - 0.0001));
  const status = (gap: number | null) => {
    if (gap === null) return <span className="muted">No target</span>;
    if (Math.abs(gap) <= ON_TARGET_WITHIN)
      return (
        <>
          <span className="status good" aria-hidden="true">
            ✓
          </span>{' '}
          On target
        </>
      );
    return (
      <>
        <span className={`status ${gap < 0 ? 'warn' : 'over'}`} aria-hidden="true">
          {gap < 0 ? '▼' : '▲'}
        </span>{' '}
        {gap < 0 ? 'Under' : 'Over'} by {Math.abs(Math.round(gap))}
      </>
    );
  };
  return (
    <table className="bars">
      <thead>
        <tr>
          <th>Category</th>
          <th aria-label="Share of time" />
          <th className="num">Actual</th>
          <th className="num">Target</th>
          <th>Status</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr
            key={r.tag.id}
            {...showTip(
              <>
                <strong>{r.tag.name}</strong>
                <br />
                {Math.round(r.minutes)} min · {Math.round(r.share)}% of practice time
                {r.target != null && (
                  <>
                    <br />
                    Target {r.target}%
                  </>
                )}
              </>,
            )}
          >
            <th scope="row">
              <span className="dot" style={{ background: r.tag.color }} />
              {r.tag.name}
            </th>
            <td className="bar-cell">
              <div className="bar-track">
                <div className={`bar-fill ${r.share > 0 ? `d${depth(r.share)}` : ''}`} style={{ width: `${(r.share / scale) * 100}%` }} />
                {r.target != null && <div className="bar-target" style={{ left: `${(r.target / scale) * 100}%` }} />}
              </div>
            </td>
            <td className="num">{Math.round(r.share)}%</td>
            <td className="num">{editing ? <TargetInput key={scope} tag={r.tag} scope={scope} onTarget={onTarget} /> : r.target != null ? `${r.target}%` : ''}</td>
            <td className="status-cell">{status(r.gap)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

type PlanMins = { plan: Plan; mins: ReturnType<typeof planMinutes> };

/**
 * A grid of categories against practices. Each square shows the minutes a practice gave a category:
 * the stronger the color, the more minutes. Practices that are planned but not yet run sit at the
 * right, striped. The base color is the viewer's own choice and is saved with their account.
 */
function CategoryHistory({
  perPlan,
  upcoming,
  tags,
  showTip,
  base,
  onChoose: choose,
}: {
  perPlan: PlanMins[];
  upcoming: PlanMins[];
  tags: Tag[];
  showTip: TipProps;
  base: string;
  onChoose: (color: string) => void;
}) {
  const columns = [...perPlan.map((c) => ({ ...c, future: false })), ...upcoming.map((c) => ({ ...c, future: true }))];
  const max = Math.max(1, ...columns.flatMap(({ mins }) => tags.map((t) => mins.byTag.get(t.id) || 0)));
  const step = Math.max(1, Math.ceil(max / HEAT_STEPS));
  const level = (m: number) => Math.min(HEAT_STEPS, Math.ceil(m / step));
  const vars: Record<string, string> = {};
  // With few practices the squares are tall and fill the width. They ease down to a compact size as columns are added.
  vars['--cell-h'] = `${Math.round(Math.max(26, 46 - columns.length * 1.4))}px`;

  return (
    <section className="card heatmap" style={vars}>
      <div className="card-head">
        <h2>Category history</h2>
        <div className="heat-color" role="group" aria-label="Color of the category history">
          <span className="muted small">Color</span>
          {HEAT_PRESETS.map((c) => (
            <button key={c} type="button" className={`swatch ${base === c ? 'on' : ''}`} style={{ background: c }} aria-label={`Use color ${c}`} aria-pressed={base === c} onClick={() => choose(c)} />
          ))}
          <label className="color-custom" title="Pick any color">
            <span className="sr-only">Pick any color</span>
            <input type="color" value={base} onChange={(e) => choose(e.target.value)} />
          </label>
        </div>
      </div>
      <p className="muted small">
        Each column is a practice and each square shows the minutes that practice gave a category. The stronger the color, the more minutes. Select
        a square to open the practice. The color you choose here is also used for the bars below.
      </p>
      <div className="heat-scroll">
        <table className="heat" style={{ minWidth: 170 + columns.length * 50 }}>
          <colgroup>
            <col style={{ width: 170 }} />
            {columns.map(({ plan }) => (
              <col key={plan.id} />
            ))}
          </colgroup>
          <thead>
            {upcoming.length > 0 && (
              <tr className="heat-groups">
                <td />
                {perPlan.length > 0 && <th colSpan={perPlan.length}>Completed</th>}
                <th colSpan={upcoming.length} className="future">
                  Coming up
                </th>
              </tr>
            )}
            <tr>
              <td />
              {columns.map(({ plan, future }) => (
                <th key={plan.id} scope="col" className={future ? 'future' : ''}>
                  <Link to={`/plans/${plan.id}`}>{fmtDateTiny(plan.date)}</Link>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {tags.map((t) => (
              <tr key={t.id}>
                <th scope="row">{t.name}</th>
                {columns.map(({ plan, mins, future }) => {
                  const m = Math.round(mins.byTag.get(t.id) || 0);
                  return (
                    <td key={plan.id}>
                      <Link
                        to={`/plans/${plan.id}`}
                        className={`heat-cell ${m === 0 ? 'zero' : `h${level(m)}`} ${future ? 'future' : ''}`}
                        aria-label={`${t.name}, ${fmtDateShort(plan.date)}${future ? ', planned' : ''}: ${m} min`}
                        {...showTip(
                          <>
                            <strong>{t.name}</strong>
                            <br />
                            {fmtDateShort(plan.date)} · {m > 0 ? `${m} min` : future ? 'not planned' : 'not worked on'}
                            {future && (
                              <>
                                <br />
                                Planned, not run yet
                              </>
                            )}
                          </>,
                        )}
                      >
                        {m > 0 ? m : ''}
                      </Link>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="heat-legend">
        <span className="heat-cell zero" /> 0 min
        {Array.from({ length: HEAT_STEPS }, (_, i) => (
          <span key={i} className="legend-step">
            <span className={`heat-cell h${i + 1}`} /> {i === HEAT_STEPS - 1 ? `${i * step + 1}+` : `${i * step + 1}-${(i + 1) * step}`}
          </span>
        ))}
        {upcoming.length > 0 && (
          <span className="legend-step">
            <span className="heat-cell h3 future" /> Planned, not run yet
          </span>
        )}
      </div>
    </section>
  );
}
