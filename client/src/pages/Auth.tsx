import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { Link, Route, Routes, useSearchParams } from 'react-router-dom';
import { api, type User } from '../api';
import { ThemeToggle } from '../theme';
import { Field } from '../components/bits';
import AuthHero from '../components/AuthHero';

const MIN_PASSWORD = 10;

/**
 * Every signed-out screen: what Dime Coach is on one side, the form on the other.
 * `tab` adds the Sign in / Sign up switch, for the two screens a visitor chooses between.
 */
export function AuthShell({
  title,
  lead,
  children,
  tab,
  onTab,
}: {
  title: string;
  lead?: string;
  children: ReactNode;
  tab?: 'in' | 'up';
  /** Switches tabs in place. Without it the tabs are links to the sign-in and sign-up addresses. */
  onTab?: (tab: 'in' | 'up') => void;
}) {
  return (
    <div className="landing">
      <AuthHero />
      <main className="landing-side">
        <div className="auth-card">
          {tab && onTab && (
            <div className="auth-tabs" role="group" aria-label="Sign in or sign up">
              <button type="button" className={tab === 'in' ? 'on' : ''} aria-pressed={tab === 'in'} onClick={() => onTab('in')}>
                Sign in
              </button>
              <button type="button" className={tab === 'up' ? 'on' : ''} aria-pressed={tab === 'up'} onClick={() => onTab('up')}>
                Sign up
              </button>
            </div>
          )}
          {tab && !onTab && (
            <nav className="auth-tabs" aria-label="Sign in or sign up">
              <Link to="/" className={tab === 'in' ? 'on' : ''} aria-current={tab === 'in' ? 'page' : undefined}>
                Sign in
              </Link>
              <Link to="/register" className={tab === 'up' ? 'on' : ''} aria-current={tab === 'up' ? 'page' : undefined}>
                Sign up
              </Link>
            </nav>
          )}
          <h1>{title}</h1>
          {lead && <p className="muted auth-lead">{lead}</p>}
          {children}
        </div>
        <div className="landing-foot">
          <ThemeToggle />
        </div>
      </main>
    </div>
  );
}

function useSubmit(action: () => Promise<void>) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      await action();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return { busy, error, submit };
}

/**
 * The very first visit, before anyone has an account. It reads as an ordinary sign-up. Whoever
 * creates this first account also runs the site, which the page says in one plain line.
 */
export function Setup({ onDone }: { onDone: () => void }) {
  const [tab, setTab] = useState<'in' | 'up'>('up');
  const [restoring, setRestoring] = useState(false);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const { busy, error, submit } = useSubmit(async () => {
    await api.setup({ name, email, password, setup_token: code || undefined });
    onDone();
  });
  if (restoring) return <Restore onDone={onDone} onBack={() => setRestoring(false)} />;
  if (tab === 'in')
    return (
      <AuthShell title="Welcome back, Coach" lead="Nobody has an account on this site yet, so there is nothing to sign in to." tab="in" onTab={setTab}>
        <p className="auth-empty">Create the first account under Sign up. After that, this is where you sign in.</p>
        <button type="button" className="btn primary" onClick={() => setTab('up')}>
          Create an account
        </button>
        <p className="muted small auth-foot">
          Already use Dime Coach somewhere else?{' '}
          <button type="button" className="link" onClick={() => setRestoring(true)}>
            Bring your account and work over
          </button>
        </p>
      </AuthShell>
    );
  return (
    <AuthShell title="Create your account" lead="You are the first one here, so this account also looks after the site and adds other coaches." tab="up" onTab={setTab}>
      <form className="fields stack" onSubmit={submit}>
        {error && <p className="error">{error}</p>}
        <Field label="Your name">
          <input className="input" autoFocus required value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" />
        </Field>
        <Field label="Email">
          <input className="input" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="username" />
        </Field>
        <Field label={`Password (at least ${MIN_PASSWORD} characters)`}>
          <input className="input" type="password" required minLength={MIN_PASSWORD} value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="new-password" />
        </Field>
        <Field label="Setup code (from the hosting settings)">
          <input className="input" value={code} onChange={(e) => setCode(e.target.value)} autoComplete="off" />
        </Field>
        <button className="btn primary" disabled={busy}>
          {busy ? 'Creating…' : 'Create account'}
        </button>
      </form>
      <p className="muted small auth-foot">
        Already have an account?{' '}
        <button type="button" className="link" onClick={() => setTab('in')}>
          Sign in
        </button>
      </p>
      <p className="muted small auth-foot">
        Already use Dime Coach somewhere else?{' '}
        <button type="button" className="link" onClick={() => setRestoring(true)}>
          Bring your account and work over
        </button>
      </p>
    </AuthShell>
  );
}

/** First visit: fill this empty site from a backup of another copy, accounts and all. */
function Restore({ onDone, onBack }: { onDone: () => void; onBack: () => void }) {
  const [file, setFile] = useState<File | null>(null);
  const [code, setCode] = useState('');
  const [count, setCount] = useState<number | null>(null);
  const { busy, error, submit } = useSubmit(async () => {
    if (!file) throw new Error('Choose the backup file first.');
    setCount((await api.restore(file, code)).accounts);
  });
  if (count !== null)
    return (
      <AuthShell title="Everything is here" lead={`${count} account${count === 1 ? '' : 's'} and all the teams, practices and plays came across. Sign in with the email and password you already use.`}>
        <button type="button" className="btn primary" onClick={onDone}>
          Go to sign in
        </button>
      </AuthShell>
    );
  return (
    <AuthShell title="Bring your work over" lead="Upload a backup from another copy of Dime Coach. Its accounts, teams, practices, drills and plays move in here, and you sign in with the same email and password as before.">
      <form className="fields stack" onSubmit={submit}>
        {error && <p className="error">{error}</p>}
        <Field label="Backup file">
          <input className="input" type="file" accept=".db,application/octet-stream" required onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
        </Field>
        <Field label="Setup code (from the hosting settings)">
          <input className="input" value={code} onChange={(e) => setCode(e.target.value)} autoComplete="off" />
        </Field>
        <button className="btn primary" disabled={busy || !file}>
          {busy ? 'Restoring…' : 'Restore backup'}
        </button>
      </form>
      <p className="muted small auth-foot">
        <button type="button" className="link" onClick={onBack}>
          Back to creating a new account
        </button>
      </p>
    </AuthShell>
  );
}

function Login({ registrationOpen, onSignedIn }: { registrationOpen: boolean; onSignedIn: () => void }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const { busy, error, submit } = useSubmit(async () => {
    await api.login(email, password);
    onSignedIn();
  });
  return (
    <AuthShell title="Welcome back, Coach" lead="Sign in to get to your practices and plays." tab="in">
      <form className="fields stack" onSubmit={submit}>
        {error && <p className="error">{error}</p>}
        <Field label="Email">
          <input className="input" type="email" autoFocus required value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="username" />
        </Field>
        <Field label="Password">
          <input className="input" type="password" required value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" />
        </Field>
        <button className="btn primary" disabled={busy}>
          {busy ? 'Signing in…' : 'Sign in'}
        </button>
      </form>
      <p className="muted small auth-foot">
        {registrationOpen ? (
          <>
            New here? <Link to="/register">Create an account</Link>
          </>
        ) : (
          'Forgot your password? Ask the administrator to reset it.'
        )}
      </p>
    </AuthShell>
  );
}

function Register({ confirm, onSignedIn }: { /** Whether a confirmation link is emailed before the account works. */ confirm: boolean; onSignedIn: () => void }) {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [sent, setSent] = useState(false);
  const { busy, error, submit } = useSubmit(async () => {
    const r = await api.register({ name, email, password });
    // With no confirmation step the account is ready and already signed in.
    if (r.user) onSignedIn();
    else setSent(true);
  });
  if (sent)
    return (
      <AuthShell title="Check your email" lead={`We sent a confirmation link to ${email}. Open it to finish creating your account. The link works for 48 hours.`}>
        <p className="muted small auth-foot">
          <Link to="/">Back to sign in</Link>
        </p>
      </AuthShell>
    );
  return (
    <AuthShell title="Join the bench" lead={confirm ? 'Create your account. You will get an email with a link to confirm your address.' : 'Create your account with an email and a password, and you are in.'} tab="up">
      <form className="fields stack" onSubmit={submit}>
        {error && <p className="error">{error}</p>}
        <Field label="Your name">
          <input className="input" autoFocus required value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" />
        </Field>
        <Field label="Email">
          <input className="input" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="username" />
        </Field>
        <Field label={`Password (at least ${MIN_PASSWORD} characters)`}>
          <input className="input" type="password" required minLength={MIN_PASSWORD} value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="new-password" />
        </Field>
        <button className="btn primary" disabled={busy}>
          {busy ? (confirm ? 'Sending…' : 'Creating…') : 'Create account'}
        </button>
      </form>
      <p className="muted small auth-foot">
        Already have an account? <Link to="/">Sign in</Link>
      </p>
    </AuthShell>
  );
}

function Confirm() {
  const [params] = useSearchParams();
  const token = params.get('token') || '';
  const [state, setState] = useState<'working' | 'done' | 'failed'>('working');
  const [error, setError] = useState('');
  useEffect(() => {
    let alive = true;
    api
      .confirm(token)
      .then(() => alive && setState('done'))
      .catch((e) => {
        if (!alive) return;
        setError((e as Error).message);
        setState('failed');
      });
    return () => {
      alive = false;
    };
  }, [token]);
  if (state === 'working') return <AuthShell title="Confirming your email…">{null}</AuthShell>;
  if (state === 'failed')
    return (
      <AuthShell title="That link did not work" lead={error}>
        <p className="muted small auth-foot">
          <Link to="/">Back to sign in</Link>
        </p>
      </AuthShell>
    );
  return (
    <AuthShell title="Email confirmed" lead="Your account is ready.">
      <Link className="btn primary" to="/">
        Sign in
      </Link>
    </AuthShell>
  );
}

/** Sign up while accounts are still handed out by the administrator. */
function InviteOnly() {
  return (
    <AuthShell title="Sign-ups are invite-only" lead="Dime Coach is still warming up, so accounts are handed out by the administrator for now." tab="up">
      <ol className="invite-steps">
        <li>Ask the administrator for an account.</li>
        <li>They send you a starting password.</li>
        <li>Sign in and choose a password of your own.</li>
      </ol>
      <Link className="btn primary" to="/">
        I have an account
      </Link>
    </AuthShell>
  );
}

/** Everything a signed-out visitor can reach. */
export function SignedOut({ registrationOpen, confirmEmail, onSignedIn }: { registrationOpen: boolean; confirmEmail: boolean; onSignedIn: () => void }) {
  return (
    <Routes>
      <Route path="/confirm" element={<Confirm />} />
      <Route path="/register" element={registrationOpen ? <Register confirm={confirmEmail} onSignedIn={onSignedIn} /> : <InviteOnly />} />
      <Route path="*" element={<Login registrationOpen={registrationOpen} onSignedIn={onSignedIn} />} />
    </Routes>
  );
}

/** Change password. `forced` is the first sign-in after an administrator set a starting password. */
export function PasswordForm({ forced, onDone }: { forced?: boolean; onDone: (user: User) => void }) {
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [saved, setSaved] = useState(false);
  const { busy, error, submit } = useSubmit(async () => {
    const { user } = await api.changePassword(current, next);
    setCurrent('');
    setNext('');
    setSaved(true);
    onDone(user);
  });
  const form = (
    <form className="fields stack" onSubmit={submit}>
      {error && <p className="error">{error}</p>}
      {saved && !forced && <p className="banner ok">Password changed. Other devices were signed out.</p>}
      <Field label={forced ? 'Password you were given' : 'Current password'}>
        <input className="input" type="password" required autoFocus={forced} value={current} onChange={(e) => setCurrent(e.target.value)} autoComplete="current-password" />
      </Field>
      <Field label={`New password (at least ${MIN_PASSWORD} characters)`}>
        <input className="input" type="password" required minLength={MIN_PASSWORD} value={next} onChange={(e) => setNext(e.target.value)} autoComplete="new-password" />
      </Field>
      <button className="btn primary" disabled={busy}>
        {busy ? 'Saving…' : 'Change password'}
      </button>
    </form>
  );
  return forced ? (
    <AuthShell title="Choose your own password" lead="The administrator gave you a starting password. Replace it with one only you know.">
      {form}
    </AuthShell>
  ) : (
    form
  );
}
