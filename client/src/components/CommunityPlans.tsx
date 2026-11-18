// For the system administrator: which communities are organizations, how many coach seats each
// has, and until when. Nothing here takes payment: it is switched by hand.
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, type CommunityPlanRow } from '../api';
import { Field, Modal } from './bits';
import { fmtDateShort } from '../util';

export default function CommunityPlans() {
  const [rows, setRows] = useState<CommunityPlanRow[] | null>(null);
  const [error, setError] = useState('');
  const [editing, setEditing] = useState<CommunityPlanRow | null>(null);
  useEffect(() => {
    api
      .communityPlans()
      .then(setRows)
      .catch((e) => setError((e as Error).message));
  }, []);
  return (
    <div className="card">
      <h2>Communities and organizations</h2>
      <p className="muted small">
        Any coach can start a community to talk and share. Putting one on the <strong>organization</strong> plan lets its admins invite coaches up to a number of seats, set up divisions and teams, build
        schedules and send announcements. You set the plan, the seats and an optional end date here. After the end date the organization can still be read, but not changed.
      </p>
      {error && <p className="error">{error}</p>}
      {rows === null ? (
        <p className="muted">Loading…</p>
      ) : rows.length === 0 ? (
        <p className="muted">Nobody has started a community yet. Once someone has, it shows here and you can make it an organization.</p>
      ) : (
        <div className="table-scroll">
          <table className="table">
            <thead>
              <tr>
                <th>Community</th>
                <th>Started by</th>
                <th className="num">Members</th>
                <th>Plan</th>
                <th>Coach seats</th>
                <th>Ends</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td>
                    <strong>{r.name}</strong>
                    {r.teams > 0 && <div className="muted small">{r.teams} teams</div>}
                  </td>
                  <td>
                    {r.creator}
                    <div className="muted small">{r.creator_email}</div>
                  </td>
                  <td className="num">{r.members}</td>
                  <td>
                    <span className={`kind ${r.plan === 'organization' ? 'game' : ''}`}>{r.plan === 'organization' ? 'Organization' : 'Group'}</span>
                    {r.lapsed && <span className="kind warn">Ended</span>}
                  </td>
                  <td>{r.plan === 'organization' ? `${r.seats_used} of ${r.seats} used` : <span className="muted">–</span>}</td>
                  <td>{r.expires ? fmtDateShort(r.expires) : <span className="muted">{r.plan === 'organization' ? 'No end' : '–'}</span>}</td>
                  <td>
                    <button type="button" className="btn small" onClick={() => setEditing(r)}>
                      {r.plan === 'organization' ? 'Change' : 'Make an organization'}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="muted small">
        To set one up for a new customer: have them create a community under <Link to="/communities">Communities</Link> (or create it yourself and make them an admin), then switch it here.
      </p>
      {editing && (
        <PlanModal
          row={editing}
          onClose={() => setEditing(null)}
          save={async (b) => {
            try {
              setRows(await api.setCommunityPlan(editing.id, b));
              setError('');
              setEditing(null);
            } catch (e) {
              setError((e as Error).message);
              setEditing(null);
            }
          }}
        />
      )}
    </div>
  );
}

function PlanModal({ row, onClose, save }: { row: CommunityPlanRow; onClose: () => void; save: (b: { plan: 'group' | 'organization'; seats: number; expires: string }) => void }) {
  const [plan, setPlan] = useState<'group' | 'organization'>('organization');
  const [seats, setSeats] = useState(row.seats || 10);
  const [expires, setExpires] = useState(row.expires);
  return (
    <Modal title={row.name} onClose={onClose}>
      <form
        className="fields stack"
        onSubmit={(e) => {
          e.preventDefault();
          save({ plan, seats, expires });
        }}
      >
        <Field label="Plan">
          <select className="input" value={plan} onChange={(e) => setPlan(e.target.value as 'group' | 'organization')}>
            <option value="organization">Organization: seats, divisions, teams, schedules, announcements</option>
            <option value="group">Group: discussion and sharing only</option>
          </select>
        </Field>
        {plan === 'organization' && (
          <>
            <Field label="Coach seats">
              <input className="input" type="number" min={0} max={100000} required value={seats} onChange={(e) => setSeats(Number(e.target.value))} />
            </Field>
            {row.plan === 'organization' && seats < row.seats_used && (
              <p className="org-note warn">
                {row.seats_used} seats are in use. Nobody is removed: the organization simply cannot add coaches until it is back under {seats}.
              </p>
            )}
            <Field label="Last day of the plan (leave empty for no end)">
              <input className="input" type="date" value={expires} onChange={(e) => setExpires(e.target.value)} />
            </Field>
          </>
        )}
        {plan === 'group' && row.teams > 0 && <p className="org-note warn">This organization has {row.teams} teams, so it cannot go back to a plain group. Set an end date to make it read-only.</p>}
        <div className="modal-actions">
          <button className="btn primary">Save</button>
        </div>
      </form>
    </Modal>
  );
}
