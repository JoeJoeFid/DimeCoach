import PageTitle from '../components/PageTitle';
import { CommunityPicker } from '../components/community';
import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api';
import { showUndo, useCompletedDeletes, usePendingDeletes } from '../components/toasts';
import { useApp } from '../App';
import type { Play } from '../types';
import { PlayBrowser } from '../components/Browsers';
import { playBuilderSupports } from '../util';
import { sportKind } from '../sports';
import PlayIntro from '../components/PlayIntro';
import { MoreMenu } from '../components/bits';
import { ShareItemDialog, useShareSummary } from '../components/ShareItem';

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

  // A play deleted a moment ago is left out, though the delete can still be undone.
  const gone = usePendingDeletes();
  const shown = (plays || []).filter((p) => !gone.has(`play:${p.id}`));

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
      const p = await api.createPlay({ sport_id: sport.id, name: 'New play', category: '' });
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
          <PageTitle
            about={{
              lead: `Diagram your ${sport!.name.toLowerCase()} plays step by step.`,
              points: ['Draw a play one step at a time and watch it run.', 'Attach plays to practice items, so the team works on them.', 'Print them on their own, or share them with the team.'],
            }}
          >
            Playbook
          </PageTitle>
        </div>
        <div className="head-actions">
          <button className="btn ghost" onClick={() => setShowIntro(true)}>
            How it works
          </button>
          {app.play_import && sportKind(sport?.name) === 'basketball' && <input ref={pdfInput} type="file" accept="application/pdf,.pdf" hidden onChange={(e) => importPdf(e.target.files?.[0])} />}
          {/* The button draws a new play. The arrow beside it holds the other ways to get one. */}
          <div className="split-btn">
            <button className="btn primary" disabled={reading} onClick={create}>
              {reading ? 'Reading the PDF…' : '+ New play'}
            </button>
            <MoreMenu
              caret
              label="More ways to add a play"
              items={[
                { label: 'From a community', onSelect: () => setFromCommunity(true) },
                // Reads a play printed as a PDF by another play designer: a step for each diagram, with its players, lines and labels.
                ...(app.play_import && sportKind(sport?.name) === 'basketball' ? [{ label: 'Import a PDF', onSelect: () => pdfInput.current?.click() }] : []),
              ]}
            />
          </div>
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
        // The same list the team's parents, family and friends see the plays shared with them in. Here a play opens to be changed, and can be shared.
        <PlayBrowser
          plays={shown}
          compactKey="practiceplan.playbookCompact"
          href={(p) => `/plays/${p.id}`}
          onShare={setSharing}
          sharedWith={(p) => sharedWith[p.id] || []}
          extra={(p) => resourceLabel((p.images || []).length + (p.videos || []).length + (p.links || []).length) || ''}
          empty={<p className="muted">No plays match.</p>}
        />
      )}
    </div>
  );
}
