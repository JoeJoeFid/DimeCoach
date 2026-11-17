// For the system administrator: how each kind of email looks, and a button to send one to
// their own address. The preview is drawn from the same page the email carries.
import { useEffect, useState } from 'react';
import { api } from '../api';

export default function EmailSamples({ canSend, run }: { canSend: boolean; run: (fn: () => Promise<unknown>, done?: string) => Promise<unknown> }) {
  const [kinds, setKinds] = useState<{ id: string; label: string }[]>([]);
  const [id, setId] = useState('');
  const [sample, setSample] = useState<{ subject: string; html: string } | null>(null);
  const [narrow, setNarrow] = useState(false);
  useEffect(() => {
    api
      .emailSamples()
      .then((list) => {
        setKinds(list);
        setId(list[0]?.id ?? '');
      })
      .catch(() => {});
  }, []);
  useEffect(() => {
    if (!id) return;
    setSample(null);
    api.emailSample(id).then(setSample, () => {});
  }, [id]);
  return (
    <div className="card email-samples">
      <h2>How the emails look</h2>
      <p className="muted small">An example of each kind of email Dime Coach sends, with made-up names. Look at it here, or send it to your own address to see it in your mail program. The links in a sample lead nowhere.</p>
      <div className="email-samples-bar">
        <select className="input" aria-label="Which email" value={id} onChange={(e) => setId(e.target.value)}>
          {kinds.map((k) => (
            <option key={k.id} value={k.id}>
              {k.label}
            </option>
          ))}
        </select>
        <div className="seg" role="group" aria-label="Width">
          <button type="button" className={narrow ? '' : 'on'} aria-pressed={!narrow} onClick={() => setNarrow(false)}>
            Computer
          </button>
          <button type="button" className={narrow ? 'on' : ''} aria-pressed={narrow} onClick={() => setNarrow(true)}>
            Phone
          </button>
        </div>
        <button type="button" className="btn primary" disabled={!canSend || !id} title={canSend ? undefined : 'No email service is connected'} onClick={() => run(() => api.sendEmailSample(id), 'The sample was sent to your own address. Check your inbox.')}>
          Send this one to me
        </button>
      </div>
      {!canSend && <p className="muted small">No email service is connected, so samples cannot be sent. The preview shows exactly what would go out.</p>}
      {sample && (
        <>
          <p className="email-samples-subject">
            <span className="muted small">Subject</span> <strong>{sample.subject}</strong>
          </p>
          {/* The email is drawn in a frame of its own, so its styles and the app's never mix. Nothing in it can run. */}
          <iframe className={`email-samples-frame ${narrow ? 'narrow' : ''}`} title={`Preview: ${sample.subject}`} sandbox="" srcDoc={sample.html} />
        </>
      )}
    </div>
  );
}
