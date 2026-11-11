import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api } from '../api';
import type { Play } from '../types';
import { PlaySteps } from '../components/PlayDiagram';
import { imageUrl } from '../components/ItemImages';
import { SheetLinks } from '../components/ItemMedia';

/** A play on its own sheet: every step with its note. */
export default function PlayPrint() {
  const { id } = useParams();
  const [play, setPlay] = useState<Play | null>(null);
  const [error, setError] = useState('');
  const [columns, setColumns] = useState(2);

  useEffect(() => {
    api
      .play(Number(id))
      .then((p) => {
        setPlay(p);
        setColumns(p.frames.length === 1 ? 1 : p.court === 'full' ? 3 : 2);
      })
      .catch((e) => setError((e as Error).message));
  }, [id]);

  if (error) return <div className="page error">{error}</div>;
  if (!play) return <div className="page muted">Loading…</div>;

  return (
    <div className="print-page">
      <div className="print-bar no-print">
        <Link className="btn" to={`/plays/${play.id}`}>
          ← Back to the play
        </Link>
        <label className="check">
          Steps per row
          <select className="input" value={columns} onChange={(e) => setColumns(Number(e.target.value))}>
            {[1, 2, 3, 4].map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        </label>
        <span className="spacer" />
        <button className="btn primary" onClick={() => window.print()}>
          Print
        </button>
      </div>

      <div className="sheet">
        <h2 style={{ fontSize: '19pt', margin: '0 0 4px' }}>{play.name}</h2>
        {(play.category || play.labels.length > 0) && (
          <p style={{ color: '#555', margin: '0 0 10px' }}>{[play.category, ...play.labels].filter(Boolean).join(' · ')}</p>
        )}
        {play.notes && <p style={{ margin: '0 0 14px', whiteSpace: 'pre-wrap' }}>{play.notes}</p>}
        <div style={columns === 1 ? { maxWidth: '70%', margin: '0 auto' } : undefined}>
          <PlaySteps play={play} columns={columns} />
        </div>
        {(play.images || []).map((im, k) => (
          <figure key={k} className="sheet-figure" style={{ margin: '12px 0', width: `${im.width_pct}%` }}>
            <img src={imageUrl(im.id)} alt={im.caption || 'Picture'} style={{ width: '100%', display: 'block' }} />
            {im.caption && <figcaption style={{ fontSize: '9pt', color: '#444', marginTop: 3 }}>{im.caption}</figcaption>}
          </figure>
        ))}
        <SheetLinks links={play.links || []} videos={(play.videos || []).length} />
      </div>
    </div>
  );
}
