// A practice someone sent by link. Anyone with the link can read it, signed in or not. A coach
// who is signed in can add a copy to one of their own teams.
import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api, type Bootstrap, type SharedPlanPage } from '../api';
import { SharedPreview } from '../components/community';
import { fmtDateShort, todayISO } from '../util';

export default function SharedPlan({ user }: { user: { id: number } | null }) {
  const { token = '' } = useParams();
  const [page, setPage] = useState<SharedPlanPage | null>(null);
  const [error, setError] = useState('');
  const [addError, setAddError] = useState('');
  const [teams, setTeams] = useState<Bootstrap['own_teams']>([]);
  const [teamId, setTeamId] = useState(0);
  const [busy, setBusy] = useState(false);
  const [added, setAdded] = useState<{ id: number; team: string } | null>(null);
  useEffect(() => {
    api
      .sharedPlan(token)
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
        // The team they were last working in, when it is one of their own.
        let last = 0;
        try {
          last = Number(localStorage.getItem(`practiceplan.teamId.${userId}`)) || 0;
        } catch {
          /* no storage: the first team will do */
        }
        setTeamId(b.own_teams.find((t) => t.id === last)?.id ?? b.own_teams[0]?.id ?? 0);
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
      const made = await api.copySharedPlan(token, { team_id: teamId, date: todayISO() });
      setAdded({ id: made.id, team: teams.find((t) => t.id === teamId)?.name ?? 'your team' });
      setAddError('');
    } catch (e) {
      setAddError((e as Error).message);
    }
    setBusy(false);
  };
  const noun = page.noun.charAt(0).toUpperCase() + page.noun.slice(1);

  return (
    <div className="pub shared-page">
      <header className="pub-head">
        <div className="pub-inner">
          <div>
            <h1>{page.title}</h1>
            <p>{[`${noun} from ${page.by}`, page.team, page.sport, page.date && fmtDateShort(page.date)].filter(Boolean).join(' · ')}</p>
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
          <SharedPreview detail={{ kind: 'plan', content: page.content }} />
        </section>
        <section className="card">
          {!user ? (
            <>
              <h2>Use Dime Coach?</h2>
              <p className="muted">Sign in to add a copy of this to your own practices, where you can change it freely.</p>
              <Link className="btn" to="?signin=1">
                Sign in
              </Link>
            </>
          ) : added ? (
            <p role="status">
              ✓ Added to {added.team}. <a href={`/plans/${added.id}`}>Open your copy</a>
            </p>
          ) : teams.length === 0 ? (
            <p className="muted">
              To add a copy of this, first <a href="/">set up a team of your own</a>.
            </p>
          ) : (
            <>
              <h2>Add a copy to your practices</h2>
              <p className="muted small">Your copy is yours to change. The original stays with {page.by}.</p>
              {addError && <p className="error">{addError}</p>}
              <div className="shared-add">
                {teams.length > 1 && (
                  <select className="input" aria-label="Team to add it to" value={teamId} onChange={(e) => setTeamId(Number(e.target.value))}>
                    {teams.map((t) => (
                      <option key={t.id} value={t.id}>
                        {[t.name, t.season].filter(Boolean).join(' · ')}
                      </option>
                    ))}
                  </select>
                )}
                <button type="button" className="btn primary" disabled={busy || !teamId} onClick={add}>
                  {busy ? 'Adding…' : 'Add to my practices'}
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
