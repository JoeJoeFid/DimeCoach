import type { Tag } from '../types';
import type { PlanMinutes } from '../util';

/**
 * Each category a plan works on with its minutes and share of the working time, most first, then
 * time with no category and breaks. Shown beside a practice being edited and in its previews.
 */
export default function CategoryRows({ mins, tags, empty }: { mins: PlanMinutes; tags: Tag[]; empty: string }) {
  const rows = tags
    .filter((t) => (mins.byTag.get(t.id) || 0) > 0)
    .map((t) => ({ tag: t, minutes: mins.byTag.get(t.id)! }))
    .sort((a, b) => b.minutes - a.minutes);
  const untagged = mins.byTag.get(0) || 0;
  const share = (m: number) => `${Math.min(100, mins.work > 0 ? Math.round((m / mins.work) * 100) : 0)}%`;
  return (
    <>
      {rows.length === 0 ? (
        <p className="muted small">{empty}</p>
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
    </>
  );
}
