// Live video of a game: sending it from this device's camera, and watching it.
//
// The camera's picture is recorded a few seconds at a time, each piece a small video file of its
// own, and sent to the server. A viewer plays the pieces one after another, some seconds behind
// what is happening. See server/streams.js for why it is built this way and how it could change.
import { useCallback, useEffect, useRef, useState } from 'react';
import { api, type GameStream, type StreamList, type StreamPerson } from '../api';
import { confirmDialog } from './dialogs';

const mb = (bytes: number) => (bytes >= 1024 * 1024 * 1024 ? `${(bytes / 1024 / 1024 / 1024).toFixed(1)} GB` : `${Math.max(1, Math.round(bytes / 1024 / 1024))} MB`);
const span = (secs: number) => {
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  const s = Math.floor(secs % 60);
  return `${h ? `${h}:` : ''}${h ? String(m).padStart(2, '0') : m}:${String(s).padStart(2, '0')}`;
};
const day = (at: string) => new Date(at).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
/** The kind of video file this browser can record, best for playing everywhere first. MP4 plays on iPhones; WebM does not on older ones. */
function recordingType(): string {
  const wanted = ['video/mp4;codecs=avc1.42E01E,mp4a.40.2', 'video/mp4', 'video/webm;codecs=vp8,opus', 'video/webm'];
  if (typeof MediaRecorder === 'undefined') return '';
  return wanted.find((t) => MediaRecorder.isTypeSupported(t)) ?? '';
}

/** Sends this device's camera out to the team. */
function Broadcast({ teamId, planId, title, canSave, onDone }: { teamId: number; planId?: number; title: string; canSave: boolean; onDone: (note: string) => void }) {
  const video = useRef<HTMLVideoElement>(null);
  const [media, setMedia] = useState<MediaStream | null>(null);
  const [facing, setFacing] = useState<'environment' | 'user'>('environment');
  const [live, setLive] = useState<GameStream | null>(null);
  const [error, setError] = useState('');
  const [sent, setSent] = useState(0);
  const [behind, setBehind] = useState(0);
  const [started, setStarted] = useState(0);
  const [, setTick] = useState(0);
  const state = useRef<{ id: number; on: boolean; queue: Blob[]; sending: boolean; timer: number; recorder: MediaRecorder | null }>({ id: 0, on: false, queue: [], sending: false, timer: 0, recorder: null });
  const mediaRef = useRef<MediaStream | null>(null);
  const lock = useRef<{ release: () => Promise<void> } | null>(null);

  // The camera, asked for when this opens and again when it is turned around.
  useEffect(() => {
    let gone = false;
    if (!navigator.mediaDevices?.getUserMedia) {
      setError('This browser cannot use the camera. Try Chrome or Safari, on a page that starts with https.');
      return;
    }
    navigator.mediaDevices
      .getUserMedia({ video: { facingMode: facing, width: { ideal: 640 }, height: { ideal: 360 }, frameRate: { ideal: 24, max: 30 } }, audio: true })
      .then((m) => {
        if (gone) return m.getTracks().forEach((t) => t.stop());
        mediaRef.current?.getTracks().forEach((t) => t.stop());
        mediaRef.current = m;
        setMedia(m);
        if (video.current) video.current.srcObject = m;
      })
      .catch((e) => setError(e?.name === 'NotAllowedError' ? 'The camera is blocked for this site. Allow the camera and the microphone in the browser, then try again.' : `The camera could not be opened: ${e?.message || e}`));
    return () => {
      gone = true;
    };
  }, [facing]);
  useEffect(
    () => () => {
      // Leaving the page stops the camera and the broadcast.
      const st = state.current;
      st.on = false;
      window.clearTimeout(st.timer);
      if (st.recorder && st.recorder.state !== 'inactive') st.recorder.stop();
      mediaRef.current?.getTracks().forEach((t) => t.stop());
      lock.current?.release().catch(() => {});
      if (st.id) api.endStream(st.id, false).catch(() => {});
    },
    [],
  );
  useEffect(() => {
    if (!live) return;
    const t = window.setInterval(() => setTick((n) => n + 1), 1000);
    return () => window.clearInterval(t);
  }, [live]);

  /** Sends what is waiting, oldest first, one at a time. */
  const pump = async () => {
    const st = state.current;
    if (st.sending) return;
    st.sending = true;
    while (st.queue.length > 0 && st.id) {
      try {
        await api.sendSegment(st.id, st.queue[0]);
        st.queue.shift();
        setSent((n) => n + 1);
      } catch (e) {
        // A stream the server has ended will not take more. Anything else is the connection: try again shortly.
        if (/ended|longest|room/.test((e as Error).message)) {
          setError((e as Error).message);
          st.on = false;
          break;
        }
        await new Promise((r) => setTimeout(r, 1500));
      }
      // Too far behind means the connection cannot keep up: the oldest pieces are dropped so the viewers stay near live.
      while (st.queue.length > 8) st.queue.shift();
      setBehind(st.queue.length);
    }
    st.sending = false;
  };
  /** Records one piece, and starts the next as this one ends, for as long as the broadcast is on. */
  const record = (type: string, seconds: number) => {
    const st = state.current;
    const m = mediaRef.current;
    if (!st.on || !m) return;
    const rec = new MediaRecorder(m, { mimeType: type, videoBitsPerSecond: 700_000, audioBitsPerSecond: 48_000 });
    st.recorder = rec;
    rec.ondataavailable = (e) => {
      if (e.data.size > 0 && st.id) {
        st.queue.push(e.data);
        setBehind(st.queue.length);
        pump();
      }
    };
    rec.start();
    st.timer = window.setTimeout(() => {
      // The next piece starts before this one stops, so nothing falls between them.
      record(type, seconds);
      if (rec.state !== 'inactive') rec.stop();
    }, seconds * 1000);
  };
  const start = async () => {
    const type = recordingType();
    if (!type) return setError('This browser cannot record video, so it cannot broadcast.');
    try {
      const today = new Date();
      const date = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
      const r = await api.startStream({ team_id: teamId, plan_id: planId, title, mime: type, date });
      state.current = { ...state.current, id: r.stream.id, on: true, queue: [] };
      setLive(r.stream);
      setStarted(Date.now());
      setSent(0);
      setError('');
      // Keeps the screen on, where the browser can: a phone that sleeps stops its camera.
      (navigator as Navigator & { wakeLock?: { request: (t: 'screen') => Promise<{ release: () => Promise<void> }> } }).wakeLock?.request('screen').then((l) => (lock.current = l), () => {});
      record(type, r.stream.segment_seconds);
    } catch (e) {
      setError((e as Error).message);
    }
  };
  const stop = async (keep: boolean) => {
    const st = state.current;
    st.on = false;
    window.clearTimeout(st.timer);
    if (st.recorder && st.recorder.state !== 'inactive') st.recorder.stop();
    // The last piece is given a moment to arrive before the stream is closed.
    await new Promise((r) => setTimeout(r, 400));
    for (let i = 0; i < 20 && (st.queue.length > 0 || st.sending); i++) await new Promise((r) => setTimeout(r, 300));
    const id = st.id;
    st.id = 0;
    lock.current?.release().catch(() => {});
    try {
      const r = await api.endStream(id, keep);
      onDone(r.saved ? 'The broadcast has ended and the video was saved.' : 'The broadcast has ended.');
    } catch (e) {
      onDone((e as Error).message);
    }
  };

  return (
    <div className="gv-cast card">
      <div className={`gv-screen ${live ? 'live' : ''}`}>
        <video ref={video} autoPlay muted playsInline />
        {live && (
          <span className="gv-badge">
            LIVE <b>{span((Date.now() - started) / 1000)}</b>
          </span>
        )}
      </div>
      {error && <p className="error">{error}</p>}
      {live ? (
        <>
          <p className="muted small gv-note">
            {sent === 0 ? 'Starting…' : `Going out to the team, a few seconds behind.`} {behind > 2 && 'The connection is slow, so viewers are further behind.'} Keep this page open and the screen on.
          </p>
          <div className="gv-actions">
            {canSave && (
              <button type="button" className="btn primary" onClick={() => stop(true)}>
                End and save the video
              </button>
            )}
            <button type="button" className="btn danger-solid" onClick={() => stop(false)}>
              {canSave ? 'End without saving' : 'End the broadcast'}
            </button>
          </div>
        </>
      ) : (
        <div className="gv-actions">
          <button type="button" className="btn primary" disabled={!media} onClick={start}>
            Go live
          </button>
          <button type="button" className="btn" disabled={!media} onClick={() => setFacing(facing === 'user' ? 'environment' : 'user')}>
            Turn the camera around
          </button>
          <button type="button" className="btn" onClick={() => onDone('')}>
            Cancel
          </button>
        </div>
      )}
    </div>
  );
}

/**
 * Plays a stream: its pieces one after another. For one that is live it starts near the newest
 * piece and waits for each next one; for a saved one it starts at the beginning and can be moved.
 */
export function StreamPlayer({ stream, onGone }: { stream: GameStream; onGone?: () => void }) {
  const video = useRef<HTMLVideoElement>(null);
  const [meta, setMeta] = useState(stream);
  const [at, setAt] = useState(stream.status === 'live' ? Math.max(0, stream.segments - 2) : 0);
  const [waiting, setWaiting] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [over, setOver] = useState(false);
  const metaRef = useRef(meta);
  metaRef.current = meta;
  const live = meta.status === 'live';
  // How far the stream has got, asked again while it is live.
  useEffect(() => {
    if (meta.status !== 'live') return;
    const t = window.setInterval(() => api.stream(stream.id).then(setMeta, () => (setOver(true), onGone?.())), 2000);
    return () => window.clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stream.id, meta.status]);
  // The piece to show: fetched whole, then played. The player itself never holds a connection
  // open, which a video element pointed straight at the server can do long after it is gone.
  const loaded = useRef(-1);
  const blobUrl = useRef('');
  const here = useRef(true);
  const playingRef = useRef(playing);
  playingRef.current = playing;
  useEffect(() => {
    const el = video.current;
    if (!el || over) return;
    if (at >= meta.segments) {
      if (meta.status === 'live') setWaiting(true);
      else {
        setPlaying(false);
        setOver(meta.segments > 0 && !meta.saved);
      }
      return;
    }
    if (loaded.current === at) return;
    loaded.current = at;
    setWaiting(false);
    fetch(`/api/streams/${stream.id}/segments/${at}`)
      .then((r) => (r.ok ? r.blob() : Promise.reject(new Error('gone'))))
      .then(
        (piece) => {
          // Moved on, or left, while it was on its way.
          if (!here.current || loaded.current !== at) return;
          if (blobUrl.current) URL.revokeObjectURL(blobUrl.current);
          blobUrl.current = URL.createObjectURL(piece);
          el.setAttribute('data-n', String(at));
          el.src = blobUrl.current;
          if (playingRef.current) el.play().catch(() => setPlaying(false));
        },
        () => here.current && loaded.current === at && next(),
      );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [at, meta.segments, meta.status, over]);
  useEffect(() => {
    here.current = true;
    const el = video.current;
    return () => {
      here.current = false;
      if (el) {
        el.pause();
        el.removeAttribute('src');
        el.load();
      }
      if (blobUrl.current) URL.revokeObjectURL(blobUrl.current);
    };
  }, []);
  const next = () => {
    const m = metaRef.current;
    // Fallen far behind a live stream: jump back near the front.
    setAt((n) => (m.status === 'live' && m.segments - n > 6 ? m.segments - 2 : n + 1));
  };
  const play = () => {
    setPlaying(true);
    video.current?.play().catch(() => setPlaying(false));
  };
  return (
    <div className="gv-player">
      <div className={`gv-screen ${live ? 'live' : ''}`}>
        <video ref={video} playsInline onEnded={next} onError={next} onPlay={() => setPlaying(true)} onPause={() => video.current && !video.current.ended && setPlaying(false)} />
        {live && !over && <span className="gv-badge">LIVE</span>}
        {!playing && !over && (
          <button type="button" className="gv-play" onClick={play} aria-label="Play">
            ▶
          </button>
        )}
        {waiting && playing && <span className="gv-wait">Waiting for the next few seconds…</span>}
        {over && <span className="gv-wait">This broadcast has ended.</span>}
      </div>
      {!live && meta.segments > 1 && (
        <div className="gv-seek">
          <span className="muted small">{span(Math.min(at, meta.segments) * meta.segment_seconds)}</span>
          <input type="range" min={0} max={meta.segments - 1} value={Math.min(at, meta.segments - 1)} aria-label="Move through the video" onChange={(e) => (setOver(false), setAt(Number(e.target.value)))} />
          <span className="muted small">{span(meta.segments * meta.segment_seconds)}</span>
        </div>
      )}
    </div>
  );
}

/** Who around a team may watch its live video and who may broadcast, person by person. */
export function StreamPeople({ teamId }: { teamId: number }) {
  const [people, setPeople] = useState<{ save: boolean; people: StreamPerson[] } | null>(null);
  const [error, setError] = useState('');
  const failed = (e: unknown) => setError((e as Error).message);
  useEffect(() => {
    setPeople(null);
    api.streamPeople(teamId).then(setPeople, failed);
  }, [teamId]);
  const setPerson = (p: StreamPerson, change: { watch?: boolean; broadcast?: boolean }) => api.setStreamPerson(teamId, p.id, change).then(setPeople, failed);
  return (
    <>
      <p className="muted small">
        Games can be broadcast live from a phone or tablet, from the game's own page. The team's coaches can always watch and broadcast. For its parents, family and friends, you choose person by person.{' '}
        {people && (people.save ? 'This team may save its game video.' : 'Saving game video is not turned on for this team: the administrator decides which teams may keep video.')}
      </p>
      {error && <p className="error">{error}</p>}
      {!people ? (
        <p className="muted">Loading…</p>
      ) : people.people.length === 0 ? (
        <p className="muted">Nobody is on this team's list of parents, family and friends yet.</p>
      ) : (
        <div className="table-scroll">
          <table className="table gv-people">
            <thead>
              <tr>
                <th>Person</th>
                <th>Watch live</th>
                <th>Broadcast</th>
              </tr>
            </thead>
            <tbody>
              {people.people.map((p) => (
                <tr key={p.id}>
                  <td>
                    {p.name}{' '}
                    <span className="muted small">
                      {p.kind}
                      {p.joined ? '' : ' · no account yet'}
                    </span>
                  </td>
                  <td>
                    <input type="checkbox" aria-label={`${p.name} may watch live video`} checked={p.watch} onChange={(e) => setPerson(p, { watch: e.target.checked })} />
                  </td>
                  <td>
                    <input type="checkbox" aria-label={`${p.name} may broadcast`} checked={p.broadcast} onChange={(e) => setPerson(p, { broadcast: e.target.checked })} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

/** One saved video as a row: play it, or delete it. */
export function SavedVideo({ stream: s, onGone }: { stream: GameStream; onGone: () => void }) {
  const [open, setOpen] = useState(false);
  const remove = async () => {
    if (!(await confirmDialog({ title: 'Delete this video?', body: `${s.title || 'Game video'}, ${day(s.started_at)}. It is gone for good, and its ${mb(s.bytes)} is freed.`, confirmLabel: 'Delete', danger: true }))) return;
    api.deleteStream(s.id).then(onGone, () => {});
  };
  return (
    <li className={open ? 'open' : ''}>
      <div className="gv-saved-row">
        <button type="button" className="track-row" aria-expanded={open} onClick={() => setOpen(!open)}>
          <strong>{s.title || 'Game video'}</strong>
          <span className="muted small">
            {day(s.started_at)} · {span(s.seconds)} · {mb(s.bytes)} · from {s.by}
          </span>
        </button>
        <button type="button" className="link small" onClick={remove}>
          Delete
        </button>
      </div>
      {open && <StreamPlayer stream={s} />}
    </li>
  );
}

/**
 * The video of a game: what is live, going live from this device, and what was saved. With a
 * `planId` it is that game's alone. Without one it is whatever the team has live, and a broadcast
 * started here is filed under the team's game of the day.
 */
export default function GameVideo({ teamId, planId, title = '' }: { teamId: number; planId?: number; title?: string }) {
  const [list, setList] = useState<StreamList | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [casting, setCasting] = useState(false);
  const load = useCallback(() => api.streams(teamId).then(setList, (e) => setError((e as Error).message)), [teamId]);
  useEffect(() => {
    load();
    // Someone going live, or stopping, shows at once.
    window.addEventListener('dime:news', load);
    const timer = window.setInterval(load, 20_000);
    return () => {
      window.removeEventListener('dime:news', load);
      window.clearInterval(timer);
    };
  }, [load]);
  if (!list) return error ? <p className="error">{error}</p> : <p className="muted">Loading…</p>;
  const { can } = list;
  const ofGame = (s: GameStream) => !planId || s.plan_id === planId;
  const live = list.live.filter(ofGame);
  const elsewhere = list.live.filter((s) => !ofGame(s));
  const saved = list.saved.filter(ofGame);
  return (
    <div className="gv">
      {error && <p className="error">{error}</p>}
      {notice && <p className="notice">{notice}</p>}
      {casting ? (
        <Broadcast
          teamId={teamId}
          planId={planId}
          title={title}
          canSave={can.save}
          onDone={(note) => {
            setCasting(false);
            setNotice(note);
            load();
          }}
        />
      ) : (
        <>
          {live.length === 0 ? (
            <div className="card gv-none">
              <h2>{planId ? 'This game is not live right now' : 'Nothing is live right now'}</h2>
              <p className="muted">{can.watch ? 'When someone broadcasts it, the video shows here to watch.' : 'Watching live video has not been turned on for you on this team.'}</p>
              {elsewhere.length > 0 && <p className="muted small">Another of this team's games is being broadcast now: {elsewhere.map((s) => s.title || 'a game').join(', ')}.</p>}
            </div>
          ) : (
            live.map((s) => (
              <div key={s.id} className="card gv-live">
                <h2>
                  {s.title || 'Live now'} <span className="muted small">from {s.by}</span>
                </h2>
                <StreamPlayer stream={s} onGone={load} />
              </div>
            ))
          )}
          {can.broadcast && (
            <div className="gv-actions">
              <button type="button" className="btn primary" onClick={() => (setNotice(''), setCasting(true))}>
                Broadcast from this device
              </button>
              <span className="muted small">
                Uses this device's camera and microphone. {can.save ? 'You can save the video when you finish.' : 'The video is not kept afterwards.'}
              </span>
            </div>
          )}
        </>
      )}
      {can.coach && !casting && (
        <div className="card">
          <h2>Saved video{planId ? ' of this game' : ''}</h2>
          <p className="muted small">
            For this team's coaches. It is also under Resources. {can.save ? '' : 'Saving video is not turned on for this team: the administrator decides which teams may keep video.'}
            {list.free_bytes !== undefined && Number.isFinite(list.free_bytes) && ` The site has ${mb(list.free_bytes)} of room left.`}
          </p>
          {saved.length === 0 ? (
            <p className="muted">No saved video yet.</p>
          ) : (
            <ul className="track-list gv-saved">
              {saved.map((s) => (
                <SavedVideo key={s.id} stream={s} onGone={load} />
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
