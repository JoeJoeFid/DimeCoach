// A season's sign-up form, for parents. Anyone with the link can open it, signed in or not.
// It shows nothing about anyone else: only the organization's name and the divisions to choose from.
import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { api, GENDER_WORD, type PublicSignup } from '../api';

const initials = (name: string) =>
  name
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0])
    .join('')
    .toUpperCase();
const EMPTY = { name: '', grade: '', league_id: 0, parent_name: '', parent_email: '', parent_phone: '', notes: '', website: '' };

export default function SignUpForm() {
  const { code = '' } = useParams();
  const [form, setForm] = useState<PublicSignup | null>(null);
  const [error, setError] = useState('');
  const [b, setB] = useState(EMPTY);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState('');
  /** The names of the players sent so far from this page. */
  const [sent, setSent] = useState<string[]>([]);
  const [done, setDone] = useState(false);
  useEffect(() => {
    api
      .publicSignup(code)
      .then((f) => {
        setForm(f);
        document.title = `Sign up: ${f.org}`;
      })
      .catch((e) => setError((e as Error).message));
  }, [code]);
  const set = (k: keyof typeof EMPTY) => (e: { target: { value: string } }) => setB((old) => ({ ...old, [k]: e.target.value }));

  if (error)
    return (
      <div className="pub">
        <div className="pub-inner">
          <div className="card">
            <h1>Nothing here</h1>
            <p className="muted">{error}</p>
          </div>
        </div>
      </div>
    );
  if (!form) return <div className="pub muted">Loading…</div>;

  const send = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      await api.sendPublicSignup(code, b);
      setSent((list) => [...list, b.name.trim()]);
      setDone(true);
      setProblem('');
    } catch (err) {
      setProblem((err as Error).message);
    }
    setBusy(false);
  };
  return (
    <div className="pub" style={form.color ? ({ '--pub': form.color } as React.CSSProperties) : undefined}>
      <header className="pub-head">
        <div className="pub-inner">
          <span className="pub-crest" aria-hidden="true">
            {form.image ? <img src={form.image} alt="" /> : initials(form.org)}
          </span>
          <div>
            <h1>{form.org}</h1>
            <p>Sign up for {form.season}</p>
          </div>
        </div>
      </header>
      <div className="pub-inner su">
        {!form.open ? (
          <div className="card">
            <h2>Sign-ups are closed</h2>
            <p className="muted">
              {form.org} is not taking sign-ups for {form.season} right now. Get in touch with them if you think this is a mistake.
            </p>
          </div>
        ) : done ? (
          <div className="card">
            <h2>{sent[sent.length - 1]} is signed up</h2>
            <p className="muted">
              {form.org} has the details, and will be in touch about teams for {form.season}.
            </p>
            {sent.length > 1 && <p className="muted small">Signed up from here so far: {sent.join(', ')}.</p>}
            <button
              type="button"
              className="btn"
              onClick={() => {
                // A brother or sister: the parent's details stay filled in.
                setB((old) => ({ ...old, name: '', grade: '', league_id: 0, notes: '' }));
                setDone(false);
              }}
            >
              Sign up another player
            </button>
          </div>
        ) : (
          <form className="card fields stack" onSubmit={send}>
            <h2>The player</h2>
            <label>
              <span className="field-label">Player's name</span>
              <input className="input" required maxLength={80} autoComplete="off" value={b.name} onChange={set('name')} />
            </label>
            <label>
              <span className="field-label">Age or grade</span>
              <input className="input" maxLength={40} value={b.grade} onChange={set('grade')} placeholder="5th grade" />
            </label>
            {form.divisions.length > 0 && (
              <label>
                <span className="field-label">Division</span>
                <select className="input" value={b.league_id} onChange={(e) => setB((old) => ({ ...old, league_id: Number(e.target.value) }))}>
                  <option value={0}>Not sure</option>
                  {form.divisions.map((d) => (
                    <option key={d.id} value={d.id}>
                      {[d.sport, d.name, GENDER_WORD[d.gender], d.age_group].filter(Boolean).join(' · ')}
                    </option>
                  ))}
                </select>
              </label>
            )}
            <h2>A parent or guardian</h2>
            <label>
              <span className="field-label">Your name</span>
              <input className="input" required maxLength={80} autoComplete="name" value={b.parent_name} onChange={set('parent_name')} />
            </label>
            <label>
              <span className="field-label">Email address</span>
              <input className="input" type="email" required maxLength={200} autoComplete="email" value={b.parent_email} onChange={set('parent_email')} />
            </label>
            <label>
              <span className="field-label">Phone number (optional)</span>
              <input className="input" type="tel" maxLength={40} autoComplete="tel" value={b.parent_phone} onChange={set('parent_phone')} />
            </label>
            <label>
              <span className="field-label">Anything the coach should know (optional)</span>
              <textarea className="input" rows={3} maxLength={1000} value={b.notes} onChange={set('notes')} />
            </label>
            {/* Left empty by people, who never see it. */}
            <input className="su-trap" tabIndex={-1} autoComplete="off" aria-hidden="true" value={b.website} onChange={set('website')} />
            {problem && <p className="error">{problem}</p>}
            <p className="muted small">
              These details go to {form.org} and to the coach of the team the player is put on. Nobody else sees them.
            </p>
            <div className="modal-actions">
              <button className="btn primary" disabled={busy}>
                {busy ? 'Sending…' : 'Sign up'}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
