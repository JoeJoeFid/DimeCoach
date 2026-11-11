import { useState } from 'react';
import { api } from '../api';
import { useApp } from '../App';
import type { Tag } from '../types';
import { SCOPES, TAG_COLORS } from '../util';
import { confirmDialog } from '../components/dialogs';

const toNumber = (v: string) => (v.trim() === '' ? null : Math.min(100, Math.max(0, Number(v) || 0)));

export default function Tags() {
  const { sport, sportTags, reload } = useApp();
  const [name, setName] = useState('');
  const [error, setError] = useState('');

  const run = async (fn: () => Promise<unknown>) => {
    try {
      await fn();
      setError('');
      await reload();
    } catch (e) {
      setError((e as Error).message);
    }
  };
  const add = () => {
    if (!name.trim() || !sport) return;
    const color = TAG_COLORS[sportTags.length % TAG_COLORS.length];
    run(() => api.createTag({ sport_id: sport.id, name: name.trim(), color, target_pct: null })).then(() => setName(''));
  };

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>Categories</h1>
          <p className="muted">
            The learning objectives you tag {sport?.name.toLowerCase()} items with. A target is the share of practice time you want spent
            working on a category. An item counts in full toward every category it is tagged with, so targets do not need to add up to 100%.
            Set one default, then override it for a single practice, a week, a month or the season where the mix should differ. A blank override
            uses the default.
          </p>
        </div>
      </div>
      {error && <p className="error">{error}</p>}

      <div className="card">
        <div className="table-scroll">
          <table className="table tag-table">
            <thead>
              <tr>
                <th>Color</th>
                <th>Name</th>
                <th className="num">Default %</th>
                {SCOPES.map((s) => (
                  <th key={s.id} className="num">
                    {s.label} %
                  </th>
                ))}
                <th />
              </tr>
            </thead>
            <tbody>
              {sportTags.map((t) => (
                <TagRow
                  key={t.id}
                  tag={t}
                  onSave={(next) => run(() => api.updateTag(next))}
                  onDelete={async () => {
                    const ok = await confirmDialog({
                      title: `Delete "${t.name}"?`,
                      body: 'It will be removed from every item that uses it.',
                      confirmLabel: 'Delete category',
                      danger: true,
                    });
                    if (ok) run(() => api.deleteTag(t.id));
                  }}
                />
              ))}
            </tbody>
          </table>
        </div>
        <form
          className="add-row"
          onSubmit={(e) => {
            e.preventDefault();
            add();
          }}
        >
          <input className="input grow" placeholder="New category, such as Free throws" value={name} onChange={(e) => setName(e.target.value)} />
          <button className="btn primary" type="submit" disabled={!name.trim()}>
            Add category
          </button>
        </form>
      </div>
    </div>
  );
}

function TagRow({ tag, onSave, onDelete }: { tag: Tag; onSave: (t: Tag) => void; onDelete: () => void }) {
  const [name, setName] = useState(tag.name);
  const [target, setTarget] = useState(tag.target_pct == null ? '' : String(tag.target_pct));
  const [overrides, setOverrides] = useState<Record<string, string>>(() =>
    Object.fromEntries(SCOPES.map((s) => [s.id, tag.targets[s.id] == null ? '' : String(tag.targets[s.id])])),
  );
  const [picking, setPicking] = useState(false);

  const commit = () => {
    if (!name.trim()) return setName(tag.name);
    const targets: Tag['targets'] = {};
    for (const s of SCOPES) {
      const v = toNumber(overrides[s.id]);
      if (v != null) targets[s.id] = v;
    }
    const next = { ...tag, name: name.trim(), target_pct: toNumber(target), targets };
    const changed = next.name !== tag.name || next.target_pct !== tag.target_pct || SCOPES.some((s) => targets[s.id] !== tag.targets[s.id]);
    if (changed) onSave(next);
  };

  return (
    <tr>
      <td className="color-cell">
        <button type="button" className="swatch" style={{ background: tag.color }} aria-label={`Change color of ${tag.name}`} onClick={() => setPicking(!picking)} />
        {picking && (
          <div className="swatches">
            {TAG_COLORS.map((c) => (
              <button
                key={c}
                type="button"
                className="swatch"
                style={{ background: c }}
                aria-label={`Use color ${c}`}
                onClick={() => {
                  setPicking(false);
                  onSave({ ...tag, color: c });
                }}
              />
            ))}
          </div>
        )}
      </td>
      <td>
        <input className="input name" aria-label="Category name" value={name} onChange={(e) => setName(e.target.value)} onBlur={commit} />
      </td>
      <td className="num">
        <input
          className="input pct"
          type="number"
          min={0}
          max={100}
          aria-label={`Default target percent for ${tag.name}`}
          placeholder="none"
          value={target}
          onChange={(e) => setTarget(e.target.value)}
          onBlur={commit}
        />
      </td>
      {SCOPES.map((s) => (
        <td key={s.id} className="num">
          <input
            className="input pct"
            type="number"
            min={0}
            max={100}
            aria-label={`${s.label} target percent for ${tag.name}`}
            placeholder={target || 'none'}
            value={overrides[s.id]}
            onChange={(e) => setOverrides({ ...overrides, [s.id]: e.target.value })}
            onBlur={commit}
          />
        </td>
      ))}
      <td className="num">
        <button className="btn small danger" onClick={onDelete}>
          Delete
        </button>
      </td>
    </tr>
  );
}
