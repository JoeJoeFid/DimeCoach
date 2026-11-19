import PageTitle from '../components/PageTitle';
import { CommunityPicker } from '../components/community';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api } from '../api';
import { showUndo, useCompletedDeletes, usePendingDeletes } from '../components/toasts';
import { useApp } from '../App';
import type { Play } from '../types';
import { PlayDiagram } from '../components/PlayDiagram';
import { playBuilderSupports } from '../util';
import { sportKind } from '../sports';
import PlayIntro from '../components/PlayIntro';
import { ShareIcon } from '../components/bits';
import { CategoryChips, LayoutToggle, useCompact } from '../components/cx';
import { ShareItemDialog, SharedWithLine, useShareSummary } from '../components/ShareItem';

const resourceLabel = (n: number) => (n > 0 ? `${n} resource${n === 1 ? '' : 's'}` : '');

/** The playbook: every diagrammed play for the current team's sport, filterable by category and tag. */
export default function Playbook() {
  const app = useApp();
  const { sport } = app;
  const navigate = useNavigate();
  const [plays, setPlays] = useState<Play[] | null>(null);
  const [error, setError] = useState('');
  const [fromCommunity, setFromCommunity] = useState(false);
  const [showIntro, setShowIntro] = useState(false);
  const [q, setQ] = useState('');
  const [category, setCategory] = useState('');
  const [label, setLabel] = useState('');
  const [compact, setCompact] = useCompact('practiceplan.playbookCompact');

  useEffect(() => {
    setPlays(null);
    api
      .plays()
      .then((all) => setPlays(all.filter((p) => p.sport_id === sport?.id)))
      .catch((e) => setError((e as Error).message));
  }, [sport?.id]);

  // A play deleted from its own page a few seconds ago is gone for real once the time to undo runs out.
  const deletes = useCompletedDeletes();
  useEffect(() => {
    if (deletes === 0) return;
    api
      .plays()
      .then((all) => setPlays(all.filter((p) => p.sport_id === sport?.id)))
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deletes]);

  const categories = useMemo(() => [...new Set((plays || []).map((p) => p.category).filter(Boolean))].sort(), [plays]);
  const labels = useMemo(() => [...new Set((plays || []).flatMap((p) => p.labels))].sort(), [plays]);
  // A play deleted a moment ago is left out, though the delete can still be undone.
  const gone = usePendingDeletes();
  const shown = (plays || []).filter((p) => !gone.has(`play:${p.id}`)).filter(
    (p) =>
      (!category || p.category === category) &&
      (!label || p.labels.includes(label)) &&
      (!q.trim() || `${p.name} ${p.category} ${p.labels.join(' ')} ${p.notes}`.toLowerCase().includes(q.trim().toLowerCase())),
  );

  // A play printed as a PDF by another play designer, read into a new play. Offered to those it is turned on for.
  const [sharing, setSharing] = useState<Play | null>(null);
  // Where each play has been shared, read again whenever the share box closes.
  const [shareVersion, setShareVersion] = useState(0);
  const sharedWith = useShareSummary('play', shareVersion);
  const pdfInput = useRef<HTMLInputElement>(null);
  const [reading, setReading] = useState(false);
  const importPdf = async (file?: File) => {
    if (!file || !sport) return;
    setError('');
    setReading(true);
    try {
      if (file.size > 15 * 1024 * 1024) throw new Error('That PDF is too large. Up to 15 MB can be read.');
      const data = await new Promise<string>((resolve, reject) => {
        const r = new FileReader();
        r.onload = () => resolve(String(r.result).split(',')[1] || '');
        r.onerror = () => reject(new Error(`Could not read ${file.name}.`));
        r.readAsDataURL(file);
      });
      const made = await api.importPlayPdf({ sport_id: sport.id, file: data, name: file.name });
      const notes = [
        `Brought in "${made.play.name}" with ${made.steps} ${made.steps === 1 ? 'step' : 'steps'}.`,
        made.left_out ? `${made.left_out} more ${made.left_out === 1 ? 'diagram was' : 'diagrams were'} left out: a play holds ${made.steps} steps.` : '',
        made.unknown ? `${made.unknown} ${made.unknown === 1 ? 'drawing was' : 'drawings were'} not understood and left off.` : '',
      ];
      showUndo({ message: notes.filter(Boolean).join(' '), onUndo: () => {}, onExpire: () => {}, action: 'OK', seconds: 12 });
      navigate(`/plays/${made.play.id}`);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setReading(false);
      if (pdfInput.current) pdfInput.current.value = '';
    }
  };

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
        <PageTitle>Playbook</PageTitle>
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
          <PageTitle>Playbook</PageTitle>
          <p className="muted">Diagram your {sport!.name.toLowerCase()} plays step by step. Attach them to practice items, or print them on their own.</p>
        </div>
        <div className="head-actions">
          <button className="btn ghost" onClick={() => setShowIntro(true)}>
            How it works
          </button>
          <button className="btn" onClick={() => setFromCommunity(true)}>
            From a community
          </button>
          {app.play_import && sportKind(sport?.name) === 'basketball' && (
            <>
              <input ref={pdfInput} type="file" accept="application/pdf,.pdf" hidden onChange={(e) => importPdf(e.target.files?.[0])} />
              <button className="btn" disabled={reading} onClick={() => pdfInput.current?.click()} title="Reads a play printed as a PDF by another play designer: a step for each diagram, with its players, lines and labels">
                {reading ? 'Reading the PDF…' : 'Import a PDF'}
              </button>
            </>
          )}
          <button className="btn primary" onClick={create}>
            + New play
          </button>
        </div>
      </div>
      {/* Shown by itself the first time, and again when asked for. */}
      {showIntro ? <PlayIntro force onClose={() => setShowIntro(false)} /> : <PlayIntro />}
      {error && <p className="error">{error}</p>}
      {sharing && <ShareItemDialog what={{ kind: 'play', id: sharing.id, title: sharing.name || 'Play' }} onClose={() => (setSharing(null), setShareVersion((v) => v + 1))} />}
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
            <LayoutToggle compact={compact} onChange={setCompact} />
          </div>
          <CategoryChips all="" total={plays.length} value={category} onChange={setCategory} items={categories.map((c) => ({ id: c, label: c, count: plays.filter((p) => p.category === c).length }))} />
          {shown.length === 0 ? (
            <p className="muted">No plays match.</p>
          ) : (
            <div className={`play-grid ${compact ? 'compact' : ''}`}>
              {shown.map((p) => (
                <div key={p.id} className="play-card-wrap">
                <Link to={`/plays/${p.id}`} className="play-card">
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
                    <SharedWithLine names={sharedWith[p.id] || []} />
                  </div>
                </Link>
                  <button type="button" className="btn small icon-btn play-share" aria-label={`Share ${p.name}`} title="Share" onClick={() => setSharing(p)}>
                    <ShareIcon size={17} />
                  </button>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}
