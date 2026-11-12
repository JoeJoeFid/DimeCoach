import { CommunityPicker } from '../components/community';
import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api } from '../api';
import { useApp } from '../App';
import type { Play } from '../types';
import { PlayDiagram } from '../components/PlayDiagram';
import { playBuilderSupports } from '../util';

const resourceLabel = (n: number) => (n > 0 ? `${n} resource${n === 1 ? '' : 's'}` : '');

/** The playbook: every diagrammed play for the current team's sport, filterable by category and tag. */
export default function Playbook() {
  const { sport } = useApp();
  const navigate = useNavigate();
  const [plays, setPlays] = useState<Play[] | null>(null);
  const [error, setError] = useState('');
  const [fromCommunity, setFromCommunity] = useState(false);
  const [q, setQ] = useState('');
  const [category, setCategory] = useState('');
  const [label, setLabel] = useState('');

  useEffect(() => {
    setPlays(null);
    api
      .plays()
      .then((all) => setPlays(all.filter((p) => p.sport_id === sport?.id)))
      .catch((e) => setError((e as Error).message));
  }, [sport?.id]);

  const categories = useMemo(() => [...new Set((plays || []).map((p) => p.category).filter(Boolean))].sort(), [plays]);
  const labels = useMemo(() => [...new Set((plays || []).flatMap((p) => p.labels))].sort(), [plays]);
  const shown = (plays || []).filter(
    (p) =>
      (!category || p.category === category) &&
      (!label || p.labels.includes(label)) &&
      (!q.trim() || `${p.name} ${p.category} ${p.labels.join(' ')} ${p.notes}`.toLowerCase().includes(q.trim().toLowerCase())),
  );

  const create = async () => {
    if (!sport) return;
    try {
      const p = await api.createPlay({ sport_id: sport.id, name: 'New play', category: category || '' });
      navigate(`/plays/${p.id}`);
    } catch (e) {
      setError((e as Error).message);
    }
  };

  if (!playBuilderSupports(sport?.name))
    return (
      <div className="page">
        <h1>Playbook</h1>
        <div className="empty">
          <h2>The play builder draws basketball, baseball and football for now</h2>
          <p>This team plays {sport?.name?.toLowerCase() || 'another sport'}. Courts and fields for other sports are not drawn yet.</p>
        </div>
      </div>
    );

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>Playbook</h1>
          <p className="muted">Diagram your {sport!.name.toLowerCase()} plays step by step. Attach them to practice items, or print them on their own.</p>
        </div>
        <div className="head-actions">
          <button className="btn" onClick={() => setFromCommunity(true)}>
            From a community
          </button>
          <button className="btn primary" onClick={create}>
            + New play
          </button>
        </div>
      </div>
      {error && <p className="error">{error}</p>}
      {fromCommunity && <CommunityPicker kind="play" onClose={() => setFromCommunity(false)} onAdded={(id) => navigate(`/plays/${id}`)} />}

      {plays === null ? (
        <p className="muted">Loading…</p>
      ) : plays.length === 0 ? (
        <div className="empty">
          <h2>No plays yet</h2>
          <p>Draw your first play. Place players, add cuts, passes, dribbles and screens, then add a step for what happens next.</p>
          <button className="btn primary" onClick={create}>
            + New play
          </button>
        </div>
      ) : (
        <>
          <div className="playbook-filters">
            <input className="input grow" placeholder="Search plays" value={q} onChange={(e) => setQ(e.target.value)} />
            <select className="input" aria-label="Filter by tag" value={label} onChange={(e) => setLabel(e.target.value)}>
              <option value="">All tags</option>
              {labels.map((l) => (
                <option key={l} value={l}>
                  {l}
                </option>
              ))}
            </select>
          </div>
          {categories.length > 0 && (
            <div className="chips category-filter" role="group" aria-label="Filter by category">
              <button className={`chip toggle ${category === '' ? 'on' : ''}`} aria-pressed={category === ''} onClick={() => setCategory('')}>
                All <span className="chip-num">{plays.length}</span>
              </button>
              {categories.map((c) => (
                <button key={c} className={`chip toggle ${category === c ? 'on' : ''}`} aria-pressed={category === c} onClick={() => setCategory(category === c ? '' : c)}>
                  {c} <span className="chip-num">{plays.filter((p) => p.category === c).length}</span>
                </button>
              ))}
            </div>
          )}
          {shown.length === 0 ? (
            <p className="muted">No plays match.</p>
          ) : (
            <div className="play-grid">
              {shown.map((p) => (
                <Link key={p.id} to={`/plays/${p.id}`} className="play-card">
                  <div className="paper">
                    <PlayDiagram play={p} frame={p.frames[0]} />
                  </div>
                  <div className="play-card-info">
                    <strong>{p.name}</strong>
                    <span className="muted small">
                      {[
                        p.category || 'No category',
                        `${p.frames.length} step${p.frames.length === 1 ? '' : 's'}`,
                        resourceLabel((p.images || []).length + (p.videos || []).length + (p.links || []).length),
                      ]
                        .filter(Boolean)
                        .join(' · ')}
                    </span>
                    {p.labels.length > 0 && (
                      <span className="chips">
                        {p.labels.map((l) => (
                          <span key={l} className="chip">
                            {l}
                          </span>
                        ))}
                      </span>
                    )}
                  </div>
                </Link>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}
