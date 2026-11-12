import PageTitle from '../components/PageTitle';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, newKey, type ImportSource } from '../api';
import { useApp } from '../App';
import type { Drill, ImportDraft, Player } from '../types';
import { fmtDuration, todayISO } from '../util';
import { DraftReview, SourcePicker, defaultChoices, resolveDraft, useAiStatus, type DraftChoices } from '../components/planImport';

interface Job {
  id: string;
  name: string;
  status: 'waiting' | 'analyzing' | 'ready' | 'failed' | 'creating' | 'created';
  source?: ImportSource;
  error?: string;
  draft?: ImportDraft;
  choices: DraftChoices;
  planId?: number;
}
const noChoices = (): DraftChoices => ({ acceptTags: new Set(), addPlayers: true, skipDrills: new Set() });

/** Import old plans as new practices. To fill a practice that already exists, use Import in its editor. */
export default function ImportPlans() {
  const app = useApp();
  const team = app.team!;
  const status = useAiStatus();
  const [jobs, setJobs] = useState<Job[]>([]);
  const [players, setPlayers] = useState<Player[]>([]);
  const [drills, setDrills] = useState<Drill[]>([]);
  const running = useRef(false);
  const jobsRef = useRef(jobs);
  jobsRef.current = jobs;

  useEffect(() => {
    api.players(team.id).then(setPlayers).catch(() => {});
    api.drills().then(setDrills).catch(() => {});
  }, [team.id]);

  const patch = useCallback((id: string, p: Partial<Job>) => {
    jobsRef.current = jobsRef.current.map((j) => (j.id === id ? { ...j, ...p } : j));
    setJobs(jobsRef.current);
  }, []);
  const add = (job: Job) => {
    jobsRef.current = [...jobsRef.current, job];
    setJobs(jobsRef.current);
  };

  // One file at a time: each analysis starts a Claude session on this computer.
  const pump = useCallback(async () => {
    if (running.current) return;
    running.current = true;
    try {
      for (;;) {
        const job = jobsRef.current.find((j) => j.status === 'waiting');
        if (!job) break;
        patch(job.id, { status: 'analyzing' });
        try {
          const draft = await api.importPlan(team.id, job.source!);
          patch(job.id, { status: 'ready', draft, choices: defaultChoices(draft) });
        } catch (e) {
          patch(job.id, { status: 'failed', error: (e as Error).message });
        }
      }
    } finally {
      running.current = false;
    }
  }, [patch, team.id]);

  const create = async (job: Job) => {
    const draft = job.draft!;
    patch(job.id, { status: 'creating', error: undefined });
    try {
      const { items, roster, drills: library } = await resolveDraft(draft, team, job.choices);
      setPlayers(roster);
      setDrills(library);
      const plan = await api.createPlan({
        team_id: team.id,
        kind: 'practice',
        title: draft.title || 'Practice',
        date: draft.date || todayISO(),
        start_time: draft.start_time || undefined,
        location: draft.location,
      });
      await api.savePlan({ ...plan, items });
      await app.reload();
      patch(job.id, { status: 'created', planId: plan.id });
    } catch (e) {
      patch(job.id, { status: 'ready', error: `Could not create the practice: ${(e as Error).message}` });
    }
  };

  const ready = jobs.filter((j) => j.status === 'ready');
  const discard = (id: string) => {
    jobsRef.current = jobsRef.current.filter((j) => j.id !== id);
    setJobs(jobsRef.current);
  };

  return (
    <div className="page editor">
      <div className="crumbs">
        <Link to="/practices">← Practices</Link>
      </div>
      <div className="page-head">
        <div>
          <PageTitle>Import old practice plans</PageTitle>
          <p className="muted">
            Each plan becomes a new practice for {team.name}, with items, times, notes, groups and categories. You review every draft before it
            is saved. To fill in a practice you already created, open it and use Import plan there.
          </p>
        </div>
      </div>

      <div className="card">
        <SourcePicker
          teamId={team.id}
          status={status}
          multiple
          onSource={(name, source) => {
            add({ id: newKey(), name, status: 'waiting', source, choices: noChoices() });
            pump();
          }}
          onDraft={(name, draft) => add({ id: newKey(), name, status: 'ready', draft, choices: defaultChoices(draft) })}
        />
      </div>

      {ready.length > 1 && (
        <div className="head-actions end">
          <button
            className="btn primary"
            onClick={async () => {
              // One at a time, so two drafts that suggest the same category or player do not create duplicates.
              for (const j of ready) await create(j);
            }}
          >
            Create all {ready.length} practices
          </button>
        </div>
      )}

      {jobs.map((job) => {
        if (job.status === 'waiting' || job.status === 'analyzing')
          return (
            <div className="card job" key={job.id}>
              <strong>{job.name}</strong>
              <span className="muted" role="status">
                {job.status === 'waiting' ? 'Waiting…' : 'Claude is reading this plan. This usually takes under a minute…'}
              </span>
            </div>
          );
        if (job.status === 'failed')
          return (
            <div className="card job" key={job.id}>
              <strong>{job.name}</strong>
              <span className="error">{job.error}</span>
              <span className="head-actions">
                <button
                  className="btn small"
                  onClick={() => {
                    patch(job.id, { status: 'waiting', error: undefined });
                    pump();
                  }}
                >
                  Try again
                </button>
                <button className="btn small" onClick={() => discard(job.id)}>
                  Discard
                </button>
              </span>
            </div>
          );
        if (job.status === 'created')
          return (
            <div className="card job" key={job.id}>
              <strong>{job.name}</strong>
              <span>
                <span className="status good" aria-hidden="true">
                  ✓
                </span>{' '}
                Practice created.
              </span>
              <Link className="btn small" to={`/plans/${job.planId}`}>
                Open practice
              </Link>
            </div>
          );
        const draft = job.draft!;
        return (
          <div className="card draft" key={job.id}>
            <div className="card-head">
              <h2>
                Draft from {job.name} <span className="muted">· {fmtDuration(draft.items.reduce((s, i) => s + i.duration_min, 0))}</span>
              </h2>
            </div>
            {job.error && <p className="error">{job.error}</p>}
            <DraftReview
              draft={draft}
              choices={job.choices}
              tags={app.sportTags}
              players={players}
              drills={drills}
              sportId={team.sport_id}
              showFields
              onDraft={(d) => patch(job.id, { draft: d })}
              onChoices={(c) => patch(job.id, { choices: c })}
            >
              <div className="modal-foot">
                <span className="muted small grow">You can edit everything after it is created.</span>
                <button className="btn" onClick={() => discard(job.id)}>
                  Discard
                </button>
                <button className="btn primary" disabled={job.status === 'creating'} onClick={() => create(job)}>
                  {job.status === 'creating' ? 'Creating…' : 'Create practice'}
                </button>
              </div>
            </DraftReview>
          </div>
        );
      })}
    </div>
  );
}
