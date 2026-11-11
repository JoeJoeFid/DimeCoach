import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { Link, Navigate, Route, Routes, useSearchParams } from 'react-router-dom';
import { api, type User } from '../api';
import { ThemeToggle } from '../theme';
import { Field } from '../components/bits';

const MIN_PASSWORD = 10;

/** The centered card used by every signed-out screen. */
export function AuthShell({ title, lead, children }: { title: string; lead?: string; children: ReactNode }) {
  return (
    <div className="auth">
      <div className="auth-card">
        <div className="brand auth-brand">
          <span className="brand-mark" aria-hidden="true" />
          PracticePlan
        </div>
        <h1>{title}</h1>
        {lead && <p className="muted">{lead}</p>}
        {children}
      </div>
      <ThemeToggle />
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

/** First run: whoever sets the app up becomes its administrator. */
export function Setup({ onDone }: { onDone: () => void }) {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const { busy, error, submit } = useSubmit(async () => {
    await api.setup({ name, email, password, setup_token: code || undefined });
    onDone();
  });
  return (
    <AuthShell
      title="Set up PracticePlan"
      lead="Create the administrator account. It takes over the teams and practices already on this install, and it is the account that adds other people."
    >
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
        <Field label="Setup code (only needed on a hosted server)">
          <input className="input" value={code} onChange={(e) => setCode(e.target.value)} autoComplete="off" />
        </Field>
        <button className="btn primary" disabled={busy}>
          {busy ? 'Creating…' : 'Create administrator account'}
        </button>
      </form>
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
    <AuthShell title="Sign in">
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
          'Accounts are created by the administrator. Ask them for one, or to reset a forgotten password.'
        )}
      </p>
    </AuthShell>
  );
}

function Register() {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [sent, setSent] = useState(false);
  const { busy, error, submit } = useSubmit(async () => {
    await api.register({ name, email, password });
    setSent(true);
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
    <AuthShell title="Create an account" lead="You will get an email with a link to confirm your address.">
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
          {busy ? 'Sending…' : 'Create account'}
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

/** Everything a signed-out visitor can reach. */
export function SignedOut({ registrationOpen, onSignedIn }: { registrationOpen: boolean; onSignedIn: () => void }) {
  return (
    <Routes>
      <Route path="/confirm" element={<Confirm />} />
      <Route path="/register" element={registrationOpen ? <Register /> : <Navigate to="/" replace />} />
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
