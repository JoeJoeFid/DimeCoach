// A drill or a play someone sent by link. Anyone with the link can see it, signed in or not. A
// coach who is signed in can add a copy to their own drills or playbook.
import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api, type Bootstrap, type SharedItemPage } from '../api';
import { SharedPreview } from '../components/community';

export default function SharedItem({ user }: { user: { id: number } | null }) {
  const { token = '' } = useParams();
  const [page, setPage] = useState<SharedItemPage | null>(null);
  const [error, setError] = useState('');
  const [addError, setAddError] = useState('');
  const [teams, setTeams] = useState<Bootstrap['own_teams']>([]);
  const [teamId, setTeamId] = useState(0);
  const [busy, setBusy] = useState(false);
  const [added, setAdded] = useState<{ kind: 'drill' | 'play'; id: number } | null>(null);
  useEffect(() => {
    api
      .sharedItem(token)
      .then((p) => {
        setPage(p);
        document.title = `${p.title} · Dime Coach`;
      })
      .catch((e) => setError((e as Error).message));
  }, [token]);
  const userId = user?.id ?? 0;
  useEffect(() => {
    if (!userId) return;
    api
      .bootstrap()
      .then((b) => {
        setTeams(b.own_teams);
        setTeamId(b.own_teams[0]?.id ?? 0);
      })
      .catch(() => {});
  }, [userId]);

  if (error)
    return (
      <div className="pub">
        <div className="pub-inner shared-gone">
          <div className="card">
            <h1>Nothing here</h1>
            <p className="muted">{error}</p>
          </div>
        </div>
      </div>
    );
  if (!page) return <div className="pub muted">Loading…</div>;
  const add = async () => {
    setBusy(true);
    try {
      setAdded(await api.copySharedItem(token, { team_id: teamId }));
      setAddError('');
    } catch (e) {
      setAddError((e as Error).message);
    }
    setBusy(false);
  };
  const noun = page.kind === 'drill' ? 'Drill' : 'Play';
  const mine = page.kind === 'drill' ? 'drills' : 'playbook';

  return (
    <div className="pub shared-page">
      <header className="pub-head">
        <div className="pub-inner">
          <div>
            <h1>{page.title}</h1>
            <p>{[`${noun} from ${page.by}`, page.sport].filter(Boolean).join(' · ')}</p>
          </div>
        </div>
      </header>
      <main className="pub-inner">
        {page.note && (
          <section className="card shared-note">
            <strong>{page.by} wrote</strong>
            <p>{page.note}</p>
          </section>
        )}
        <section className="card">
          <SharedPreview detail={{ kind: page.kind, content: page.content }} />
        </section>
        <section className="card">
          {!user ? (
            <>
              <h2>Use Dime Coach?</h2>
              <p className="muted">Sign in to add a copy of this to your own {mine}, where you can change it freely.</p>
              <Link className="btn" to="?signin=1">
                Sign in
              </Link>
            </>
          ) : added ? (
            <p role="status">
              ✓ Added to your {mine}. <a href={added.kind === 'play' ? `/plays/${added.id}` : '/library'}>{added.kind === 'play' ? 'Open your copy' : 'Go to your drills'}</a>
            </p>
          ) : teams.length === 0 ? (
            <p className="muted">
              To add a copy of this, first <a href="/">set up a team of your own</a>.
            </p>
          ) : (
            <>
              <h2>Add a copy to your {mine}</h2>
              <p className="muted small">Your copy is yours to change. The original stays with {page.by}.</p>
              {addError && <p className="error">{addError}</p>}
              <div className="shared-add">
                {teams.length > 1 && (
                  <select className="input" aria-label="Team to add it for" value={teamId} onChange={(e) => setTeamId(Number(e.target.value))}>
                    {teams.map((t) => (
                      <option key={t.id} value={t.id}>
                        {[t.name, t.season].filter(Boolean).join(' · ')}
                      </option>
                    ))}
                  </select>
                )}
                <button type="button" className="btn primary" disabled={busy || !teamId} onClick={add}>
                  {busy ? 'Adding…' : `Add to my ${mine}`}
                </button>
              </div>
            </>
          )}
        </section>
        <p className="pub-foot muted small">
          Shared with{' '}
          <a href="/" className="pub-brand">
            <span className="brand-mark" aria-hidden="true" />
            Dime Coach
          </a>
        </p>
      </main>
    </div>
  );
}
