// Live video of a game: sending it from this device's camera, and watching it.
//
// The camera's picture is recorded a few seconds at a time, each piece a small video file of its
// own, and sent out. A viewer plays the pieces one after another, some seconds behind what is
// happening. How the pieces travel is in ../video.ts, and why it is built this way is in
// server/streams.js.
import { useCallback, useEffect, useRef, useState, type ReactNode, type RefObject } from 'react';
import { api, type GameStream, type StreamList, type StreamPerson } from '../api';
import { LIVE_BACK, PICKS, QUALITIES, RUNGS, Stopped, cannotJoin, autoStart, autoStep, bringInVideo, cameraSize, joinedPlayer, openBroadcast, pieceBroadcaster, pieceFetcher, type Auto, type Bringing, type Broadcaster, type JoinedPlayer, type Quality } from '../video';
import { BinIcon, Modal, PlayIcon } from './bits';
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

/** Where a broadcast's video goes when it is over: nowhere, this device, Dime Coach, or both. */
type Keep = 'none' | 'device' | 'site' | 'both';
/** The groups of people who can be told a broadcast has begun. */
const TELL = [
  { key: 'coaches', label: 'Coaches' },
  { key: 'parents', label: 'Parents' },
  { key: 'family', label: 'Family' },
  { key: 'friends', label: 'Friends' },
];
/** What the broadcaster chose last time, on this device, so they are not asked from scratch every game. */
function lastSetup(): { keep: Keep; sound: boolean; tell: string[]; quality: Quality; auto: boolean } | null {
  try {
    const v = JSON.parse(localStorage.getItem('dime.broadcast') || 'null');
    if (!v || !['none', 'device', 'site', 'both'].includes(v.keep)) return null;
    return { keep: v.keep, sound: v.sound !== false, tell: Array.isArray(v.tell) ? TELL.map((g) => g.key).filter((k) => v.tell.includes(k)) : TELL.map((g) => g.key), quality: PICKS.includes(v.quality) ? v.quality : 'low', auto: v.auto !== false };
  } catch {
    return null;
  }
}
/** A name for the file a broadcast is saved to on this device. */
function fileName(title: string, type: string, part = 0) {
  const d = new Date();
  const day = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const safe = (title || 'Game video').replace(/[\\/:*?"<>|]+/g, ' ').replace(/\s+/g, ' ').trim() || 'Game video';
  return `${safe} ${day}${part ? ` part ${part}` : ''}.${type.includes('mp4') ? 'mp4' : 'webm'}`;
}

/**
 * Sends this device's camera out to the team. It opens on the camera's picture with what to
 * decide before going live: whether the video is kept, where, and whether sound goes out.
 */
function Broadcast({ teamId, planId, title, canSave, onDone }: { teamId: number; planId?: number; title: string; canSave: boolean; onDone: (note: string) => void }) {
  const video = useRef<HTMLVideoElement>(null);
  const [media, setMedia] = useState<MediaStream | null>(null);
  const [facing, setFacing] = useState<'environment' | 'user'>('environment');
  const [live, setLive] = useState<GameStream | null>(null);
  const [error, setError] = useState('');
  const [sent, setSent] = useState(0);
  const [behind, setBehind] = useState(0);
  const [started, setStarted] = useState(0);
  const [opening, setOpening] = useState(false);
  const [ending, setEnding] = useState(false);
  const [, setTick] = useState(0);
  // The setup. Dime Coach can only be chosen for a team that may keep video.
  const [keep, setKeep] = useState<Keep>(() => {
    const was = lastSetup()?.keep ?? (canSave ? 'site' : 'none');
    return canSave ? was : was === 'none' ? 'none' : 'device';
  });
  const [sound, setSound] = useState(() => lastSetup()?.sound ?? true);
  // Who is told it has begun: everyone, unless the broadcaster opens the list and picks groups. None is nobody.
  const [tell, setTell] = useState<string[]>(() => lastSetup()?.tell ?? TELL.map((g) => g.key));
  // How sharp the picture is. It can be changed while live, when the connection turns out better or worse than hoped.
  // Left on Auto, it starts at Low and moves with the connection: down when pieces pile up, back up when there is room to spare.
  const [auto, setAuto] = useState(() => lastSetup()?.auto ?? true);
  const [quality, setQuality] = useState<Quality>(() => {
    const was = lastSetup();
    return was && !was.auto ? was.quality : 'low';
  });
  const qualityRef = useRef(quality);
  qualityRef.current = quality;
  const autoRef = useRef<Auto | null>(null);
  if (!auto) autoRef.current = null;
  else if (!autoRef.current || autoRef.current.at !== quality) autoRef.current = autoStart(quality, Date.now());
  // The video kept on this device, once the broadcast is over, waiting to be saved out of the page.
  // More than one file when the quality was changed along the way.
  const [file, setFile] = useState<{ blobs: Blob[]; seconds: number; note: string } | null>(null);
  const [savedParts, setSavedParts] = useState<number[]>([]);
  const fileSaved = !!file && file.blobs.every((_, i) => savedParts.includes(i));
  const state = useRef<{ id: number; cast: Broadcaster | null }>({ id: 0, cast: null });
  const mediaRef = useRef<MediaStream | null>(null);
  const soundRef = useRef(sound);
  soundRef.current = sound;
  const lock = useRef<{ release: () => Promise<void> } | null>(null);
  const toSite = keep === 'site' || keep === 'both';
  const toDevice = keep === 'device' || keep === 'both';

  // The camera, asked for when this opens and again when it is turned around.
  useEffect(() => {
    let gone = false;
    if (!navigator.mediaDevices?.getUserMedia) {
      setError('This browser cannot use the camera. Try Chrome or Safari, on a page that starts with https.');
      return;
    }
    navigator.mediaDevices
      .getUserMedia({ video: { facingMode: facing, ...cameraSize(qualityRef.current), frameRate: { ideal: 24, max: 30 } }, audio: true })
      .then((m) => {
        if (gone) return m.getTracks().forEach((t) => t.stop());
        mediaRef.current?.getTracks().forEach((t) => t.stop());
        m.getAudioTracks().forEach((t) => (t.enabled = soundRef.current));
        mediaRef.current = m;
        setMedia(m);
        if (video.current) video.current.srcObject = m;
      })
      .catch((e) => setError(e?.name === 'NotAllowedError' ? 'The camera is blocked for this site. Allow the camera and the microphone in the browser, then try again.' : `The camera could not be opened: ${e?.message || e}`));
    return () => {
      gone = true;
    };
  }, [facing]);
  // Sound off is silence from the microphone: the picture carries on, and so does the recording.
  useEffect(() => {
    mediaRef.current?.getAudioTracks().forEach((t) => (t.enabled = sound));
  }, [sound, media]);
  useEffect(() => {
    try {
      localStorage.setItem('dime.broadcast', JSON.stringify({ keep, sound, tell, quality, auto }));
    } catch {
      /* not kept for next time */
    }
  }, [keep, sound, tell, quality, auto]);
  /** Changes the quality: of the camera's picture before going live, and of the broadcast itself once it is. */
  const pickQuality = (q: Quality, byHand = true) => {
    // Choosing one by hand holds it there.
    if (byHand) setAuto(false);
    if (q === qualityRef.current) return;
    qualityRef.current = q;
    setQuality(q);
    if (state.current.cast) state.current.cast.quality(q).catch(() => {});
    else mediaRef.current?.getVideoTracks()[0]?.applyConstraints(cameraSize(q)).catch(() => {});
  };
  const letGo = () => {
    mediaRef.current?.getTracks().forEach((t) => t.stop());
    lock.current?.release().catch(() => {});
  };
  useEffect(
    () => () => {
      // Leaving the page stops the camera and the broadcast.
      const st = state.current;
      st.cast?.stop(false);
      letGo();
      if (st.id) api.endStream(st.id, false).catch(() => {});
    },
    [],
  );
  useEffect(() => {
    if (!live) return;
    const t = window.setInterval(() => setTick((n) => n + 1), 1000);
    return () => window.clearInterval(t);
  }, [live]);

  /** A small picture of what the camera sees, to show the video by afterwards. */
  const sendPicture = (id: number) => {
    const el = video.current;
    if (!el || !el.videoWidth || state.current.id !== id) return;
    const c = document.createElement('canvas');
    c.width = 480;
    c.height = Math.round((480 * el.videoHeight) / el.videoWidth);
    c.getContext('2d')?.drawImage(el, 0, 0, c.width, c.height);
    c.toBlob((b) => b && state.current.id === id && api.sendPoster(id, b), 'image/jpeg', 0.72);
  };
  const start = async () => {
    const type = recordingType();
    if (!type) return setError('This browser cannot record video, so it cannot broadcast.');
    setOpening(true);
    // The camera starts recording now, which also shows whether this browser can make one unbroken video. It takes a couple of seconds.
    const open = await openBroadcast(() => mediaRef.current, type, quality);
    try {
      const today = new Date();
      const date = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
      const r = await api.startStream({ team_id: teamId, plan_id: planId, title, mime: type, date, layout: open.layout, tell });
      // The server says how the pieces are to be sent. How the broadcast is getting on comes back as it goes.
      const heard = (s: { sent: number; behind: number; rate?: number; stalled?: boolean; error?: string }) => {
        setSent(s.sent);
        setBehind(s.behind);
        if (s.error) setError(s.error);
        // On Auto, the quality follows how the pieces are getting out.
        const was = autoRef.current;
        if (!was || s.error || !state.current.cast) return;
        const now = autoStep(was, s, Date.now());
        autoRef.current = now;
        if (now.at !== was.at) pickQuality(now.at, false);
      };
      // The server has the last word on the layout.
      const agreed = r.stream.layout === open.layout;
      if (!agreed) open.cancel();
      const cast = agreed ? open.begin(r.stream, r.send, heard, toDevice) : pieceBroadcaster(() => mediaRef.current, r.stream, r.send, type, heard, toDevice, quality);
      state.current = { id: r.stream.id, cast };
      if (autoRef.current) autoRef.current = autoStart(qualityRef.current, Date.now());
      setLive(r.stream);
      setStarted(Date.now());
      setSent(0);
      setError('');
      // Keeps the screen on, where the browser can: a phone that sleeps stops its camera.
      (navigator as Navigator & { wakeLock?: { request: (t: 'screen') => Promise<{ release: () => Promise<void> }> } }).wakeLock?.request('screen').then((l) => (lock.current = l), () => {});
      cast.start();
      window.setTimeout(() => sendPicture(r.stream.id), 3000);
    } catch (e) {
      open.cancel();
      setError((e as Error).message);
    } finally {
      setOpening(false);
    }
  };
  const stop = async () => {
    const st = state.current;
    setEnding(true);
    // What is still waiting is given a moment to go out before the stream is closed.
    await st.cast?.stop();
    const blobs = toDevice ? (st.cast?.recording() ?? []).filter((b) => b.size > 0) : [];
    const seconds = (Date.now() - started) / 1000;
    const id = st.id;
    st.id = 0;
    letGo();
    let note = '';
    try {
      const r = await api.endStream(id, toSite && canSave);
      note = r.saved ? 'The broadcast has ended and the video was saved to Dime Coach.' : 'The broadcast has ended.';
    } catch (e) {
      note = (e as Error).message;
    }
    // A copy for this device stays on the screen until it has been saved out of the page.
    if (blobs.length > 0) {
      setLive(null);
      setEnding(false);
      setFile({ blobs, seconds, note });
    } else onDone(toDevice ? `${note} The video could not be kept on this device.` : note);
  };
  /** Hands the kept video to the device: its share sheet on a phone or tablet, a download anywhere else. */
  const saveFile = async (i: number) => {
    if (!file) return;
    const done = () => setSavedParts((was) => (was.includes(i) ? was : [...was, i]));
    const f = new File([file.blobs[i]], fileName(title, file.blobs[i].type, file.blobs.length > 1 ? i + 1 : 0), { type: file.blobs[i].type });
    const touch = window.matchMedia('(pointer: coarse)').matches;
    if (touch && navigator.canShare?.({ files: [f] })) {
      try {
        await navigator.share({ files: [f], title: title || 'Game video' });
        return done();
      } catch (e) {
        // Closing the sheet is not a failure. Anything else falls through to a download.
        if ((e as Error).name === 'AbortError') return;
      }
    }
    const url = URL.createObjectURL(f);
    const a = document.createElement('a');
    a.href = url;
    a.download = f.name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
    done();
  };
  const leave = async () => {
    if (file && !fileSaved && !(await confirmDialog({ title: 'Leave without saving the video?', body: 'The video is only on this page. Once you leave, it cannot be saved to this device.', confirmLabel: 'Leave', danger: true }))) return;
    onDone(file?.note ?? '');
  };

  if (file)
    return (
      <div className="gv-cast gv-done card">
        <h2>Save the video to this device</h2>
        <p className="muted">
          {file.note} The video is {span(file.seconds)} long and {mb(file.blobs.reduce((n, b) => n + b.size, 0))}. It is only on this page until you save it.
          {file.blobs.length > 1 && ` The quality was changed during the broadcast, so it is in ${file.blobs.length} parts, one for each quality: save each one.`}
        </p>
        {fileSaved && <p className="notice">Sent to this device. Check that it is there before you leave this page.</p>}
        <div className="gv-actions">
          {file.blobs.map((b, i) => (
            <button key={i} type="button" className={`btn ${savedParts.includes(i) ? '' : 'primary'}`} onClick={() => saveFile(i)}>
              {file.blobs.length === 1 ? (fileSaved ? 'Save it again' : 'Save to this device') : `${savedParts.includes(i) ? 'Save again: part' : 'Save part'} ${i + 1} (${mb(b.size)})`}
            </button>
          ))}
          <button type="button" className="btn" onClick={leave}>
            Done
          </button>
        </div>
      </div>
    );
  const kept = keep === 'both' ? 'saved to this device and to Dime Coach' : keep === 'site' ? 'saved to Dime Coach' : keep === 'device' ? 'saved to this device' : '';
  return (
    <div className="gv-cast card">
      <div className={`gv-screen ${live ? 'live' : ''}`}>
        <video ref={video} autoPlay muted playsInline />
        {live && (
          <span className="gv-badge">
            LIVE <b>{span((Date.now() - started) / 1000)}</b>
          </span>
        )}
        {!sound && <span className="gv-muted">Sound off</span>}
      </div>
      {error && <p className="error">{error}</p>}
      {live ? (
        <>
          <p className="muted small gv-note">
            {sent === 0 ? 'Starting…' : `Going out to the team, a few seconds behind.`} {behind > 2 && (auto ? (quality === RUNGS[0] ? 'The connection is slow, so viewers are further behind.' : 'The connection is slow, so the quality is being lowered.') : 'The connection is slow, so viewers are further behind. A lower quality, or Auto, may help.')} Keep this page open and the screen on.{' '}
            {kept ? `When you end, the video is ${kept}.` : 'The video is not kept when you end.'}
          </p>
          <div className="gv-actions">
            <div className="seg gv-quality" role="group" aria-label="Quality">
              <button type="button" className={auto ? 'on' : ''} aria-pressed={auto} disabled={ending} title="Moves with the connection: down when it is slow, up when there is room to spare" onClick={() => setAuto(true)}>
                {auto ? `Auto · ${QUALITIES[quality].label}` : 'Auto'}
              </button>
              {PICKS.map((q) => (
                <button key={q} type="button" className={!auto && quality === q ? 'on' : ''} aria-pressed={!auto && quality === q} disabled={ending} title={QUALITIES[q].says} onClick={() => pickQuality(q)}>
                  {QUALITIES[q].label}
                </button>
              ))}
            </div>
            <button type="button" className="btn" aria-pressed={!sound} disabled={ending} onClick={() => setSound(!sound)}>
              {sound ? 'Mute sound' : 'Turn sound on'}
            </button>
            <button type="button" className="btn danger-solid" disabled={ending} onClick={stop}>
              {ending ? 'Ending…' : 'End the broadcast'}
            </button>
          </div>
        </>
      ) : (
        <>
          <div className="gv-setup">
            <div className="gv-opt">
              <span>When it ends</span>
              <div className="seg" role="group" aria-label="When the broadcast ends">
                <button type="button" className={keep === 'none' ? 'on' : ''} aria-pressed={keep === 'none'} onClick={() => setKeep('none')}>
                  Just stream
                </button>
                <button type="button" className={keep !== 'none' ? 'on' : ''} aria-pressed={keep !== 'none'} onClick={() => keep === 'none' && setKeep(canSave ? 'site' : 'device')}>
                  Save the video
                </button>
              </div>
            </div>
            {keep !== 'none' && (
              <div className="gv-opt">
                <span>Save it to</span>
                <div className="seg" role="group" aria-label="Where the video is saved">
                  <button type="button" className={keep === 'device' ? 'on' : ''} aria-pressed={keep === 'device'} onClick={() => setKeep('device')}>
                    This device
                  </button>
                  {canSave && (
                    <>
                      <button type="button" className={keep === 'site' ? 'on' : ''} aria-pressed={keep === 'site'} onClick={() => setKeep('site')}>
                        Dime Coach
                      </button>
                      <button type="button" className={keep === 'both' ? 'on' : ''} aria-pressed={keep === 'both'} onClick={() => setKeep('both')}>
                        Both
                      </button>
                    </>
                  )}
                </div>
                {!canSave && <span className="muted small">Saving to Dime Coach is not turned on for this team.</span>}
              </div>
            )}
            <div className="gv-opt">
              <span>Tell people</span>
              <div className="seg" role="group" aria-label="Tell people the broadcast has begun">
                <button type="button" className={tell.length > 0 ? 'on' : ''} aria-pressed={tell.length > 0} onClick={() => tell.length === 0 && setTell(TELL.map((g) => g.key))}>
                  On
                </button>
                <button type="button" className={tell.length === 0 ? 'on' : ''} aria-pressed={tell.length === 0} onClick={() => setTell([])}>
                  Off
                </button>
              </div>
              <span className="muted small">
                {tell.length === TELL.length
                  ? 'Everyone who may watch gets a message and a notification.'
                  : tell.length === 0
                    ? 'Nobody is told. It still shows as live in the app.'
                    : `Only ${TELL.filter((g) => tell.includes(g.key)).map((g) => g.label.toLowerCase()).join(', ')}.`}
              </span>
              {/* Who is told, there to press whenever telling is on: the ones in green are told. */}
              {tell.length > 0 && (
                <div className="gv-tell" role="group" aria-label="Who is told">
                  {TELL.map((g) => {
                    const on = tell.includes(g.key);
                    return (
                      <button key={g.key} type="button" className={`chip toggle ${on ? 'on' : ''}`} aria-pressed={on} onClick={() => setTell(on ? tell.filter((k) => k !== g.key) : TELL.map((x) => x.key).filter((k) => k === g.key || tell.includes(k)))}>
                        {g.label}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
            <div className="gv-opt">
              <span>Quality</span>
              <div className="seg gv-quality" role="group" aria-label="Quality">
                <button type="button" className={auto ? 'on' : ''} aria-pressed={auto} onClick={() => (pickQuality('low', false), setAuto(true))}>
                  Auto
                </button>
                {PICKS.map((q) => (
                  <button key={q} type="button" className={!auto && quality === q ? 'on' : ''} aria-pressed={!auto && quality === q} onClick={() => pickQuality(q)}>
                    {QUALITIES[q].label}
                  </button>
                ))}
              </div>
              <span className="muted small">
                {auto ? `Starts at Low, then moves up or down with the connection.${toDevice ? ' The copy on this device comes out as one file for each change.' : ''}` : `${QUALITIES[quality].says} You can change this while you are live.`}
              </span>
            </div>
            <div className="gv-opt">
              <span>Sound</span>
              <div className="seg" role="group" aria-label="Sound">
                <button type="button" className={sound ? 'on' : ''} aria-pressed={sound} onClick={() => setSound(true)}>
                  On
                </button>
                <button type="button" className={!sound ? 'on' : ''} aria-pressed={!sound} onClick={() => setSound(false)}>
                  Off
                </button>
              </div>
              <span className="muted small">You can change this while you are live.</span>
            </div>
          </div>
          <div className="gv-actions">
            <button type="button" className="btn primary" disabled={!media || opening} onClick={start}>
              {opening ? 'Starting…' : 'Go live'}
            </button>
            <button type="button" className="btn" disabled={!media || opening} onClick={() => setFacing(facing === 'user' ? 'environment' : 'user')}>
              Turn the camera around
            </button>
            <button type="button" className="btn" onClick={() => onDone('')}>
              Cancel
            </button>
          </div>
        </>
      )}
    </div>
  );
}

/**
 * Plays a stream. For one that is live it starts near the newest piece and waits for each next
 * one; for a saved one it starts at the beginning and can be moved. A video whose pieces join up
 * is played as one unbroken video where the browser can, and piece by piece where it cannot.
 */
export function StreamPlayer({ stream, onGone }: { stream: GameStream; onGone?: () => void }) {
  // Why it is being played piece by piece, when it could have been one unbroken video: said under the player, so the cause can be found.
  const [plain, setPlain] = useState('');
  return stream.layout === 'joined' && !plain ? <JoinedVideo stream={stream} onGone={onGone} onFail={(why) => setPlain(why || 'it could not be played as one video')} /> : <PieceVideo stream={stream} onGone={onGone} why={plain} />;
}

type Fullable = HTMLElement & { webkitRequestFullscreen?: () => void };
type FullDoc = Document & { webkitFullscreenElement?: Element | null; webkitExitFullscreen?: () => void };
/**
 * Filling the whole screen with a player, and coming back. The player goes full screen with what
 * is drawn over the picture and its slider. An iPhone will only do that for the video itself, so
 * there it is the video alone, with the phone's own controls.
 */
export function useFullScreen(frame: RefObject<HTMLDivElement | null>, video: RefObject<HTMLVideoElement | null>): [boolean, () => void] {
  const [full, setFull] = useState(false);
  useEffect(() => {
    const d = document as FullDoc;
    const changed = () => setFull(!!frame.current && (d.fullscreenElement ?? d.webkitFullscreenElement ?? null) === frame.current);
    document.addEventListener('fullscreenchange', changed);
    document.addEventListener('webkitfullscreenchange', changed);
    return () => {
      document.removeEventListener('fullscreenchange', changed);
      document.removeEventListener('webkitfullscreenchange', changed);
    };
  }, [frame]);
  const toggle = () => {
    const d = document as FullDoc;
    const el = frame.current as Fullable | null;
    if (d.fullscreenElement ?? d.webkitFullscreenElement) return void (d.exitFullscreen ? d.exitFullscreen() : d.webkitExitFullscreen?.());
    if (el?.requestFullscreen) return void el.requestFullscreen().catch(() => {});
    if (el?.webkitRequestFullscreen) return el.webkitRequestFullscreen();
    (video.current as (HTMLVideoElement & { webkitEnterFullscreen?: () => void }) | null)?.webkitEnterFullscreen?.();
  };
  return [full, toggle];
}
export function FullButton({ full, onClick }: { full: boolean; onClick: () => void }) {
  return (
    <button type="button" className="gv-full" onClick={onClick} aria-label={full ? 'Leave full screen' : 'Full screen'} title={full ? 'Leave full screen' : 'Full screen'}>
      <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d={full ? 'M9 4v5H4M15 4v5h5M9 20v-5H4M15 20v-5h5' : 'M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5'} />
      </svg>
    </button>
  );
}

/**
 * The slider of a bar for moving through a video, a second to a step, with the time it is at
 * before it. While it is being dragged it shows where it is held, and the video is only moved
 * once the hand rests: moving it at every step would fetch video nobody watches.
 */
export function SeekInput({ value, max, label, say, onSeek, loaded }: { value: number; max: number; label: string; say: (seconds: number) => string; onSeek: (seconds: number) => void; /** How far the video is loaded and ready, in seconds from its start: shown fainter on the bar, past where it is. */ loaded?: number }) {
  const [held, setHeld] = useState<number | null>(null);
  const timer = useRef(0);
  const seek = useRef(onSeek);
  seek.current = onSeek;
  useEffect(() => () => window.clearTimeout(timer.current), []);
  const change = (v: number) => {
    setHeld(v);
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => {
      setHeld(null);
      seek.current(v);
    }, 150);
  };
  const shown = held ?? Math.min(value, max);
  const share = (n: number) => `${max > 0 ? Math.max(0, Math.min(100, (n / max) * 100)) : 0}%`;
  return (
    <>
      <span className="muted small">{say(shown)}</span>
      <input
        type="range"
        className="gv-range"
        min={0}
        max={max}
        step={1}
        value={shown}
        aria-label={label}
        style={{ '--played': share(shown), '--loaded': share(Math.max(shown, held === null ? (loaded ?? 0) : 0)) } as React.CSSProperties}
        onChange={(e) => change(Number(e.target.value))}
      />
    </>
  );
}

/** A number of seconds into a video as the piece it falls in and how far into that piece. */
const markAt = (seconds: number, meta: GameStream) => {
  const s = Math.max(0, Math.min(seconds, meta.segments * meta.segment_seconds - 1));
  return { n: Math.floor(s / meta.segment_seconds), off: s % meta.segment_seconds, s };
};

/**
 * The bar under a video for moving through it. A saved video runs from its start to its end. A
 * live one runs from its start to now, and keeps growing: a viewer can go back to see something
 * again, forward as far as the newest, and straight back to live.
 */
function SeekBar({ at, meta, behind, onSeek, onLive, ahead }: { at: number; meta: GameStream; behind: boolean; onSeek: (seconds: number) => void; onLive: () => void; /** Seconds loaded past where it is, when the player says. */ ahead?: number }) {
  if (meta.segments <= 1) return null;
  const live = meta.status === 'live';
  const total = meta.segments * meta.segment_seconds;
  // Where it really is: watching live that is a few seconds short of the end, with what is in hand showing fainter up to it.
  const shown = Math.min(at, total);
  return (
    <div className="gv-seek">
      <SeekInput value={shown} max={total} loaded={ahead === undefined ? undefined : shown + ahead} label={live ? 'Go back or forward through the broadcast' : 'Move through the video'} say={span} onSeek={onSeek} />
      {!live ? (
        <span className="muted small">{span(meta.segments * meta.segment_seconds)}</span>
      ) : behind ? (
        <button type="button" className="btn small" onClick={onLive}>
          Go to live
        </button>
      ) : (
        <span className="gv-atlive">Live</span>
      )}
    </div>
  );
}

/** A video whose pieces join up, played as one. */
function JoinedVideo({ stream, onGone, onFail }: { stream: GameStream; onGone?: () => void; onFail: (why: string) => void }) {
  const video = useRef<HTMLVideoElement>(null);
  const [meta, setMeta] = useState(stream);
  const frame = useRef<HTMLDivElement>(null);
  const [full, toggleFull] = useFullScreen(frame, video);
  // Where playing starts from: moving through the video starts it again from there. `follow` is
  // watching live, kept near the newest; going back through a live broadcast turns it off.
  const [start, setStart] = useState({ from: stream.status === 'live' ? Math.max(0, stream.segments - LIVE_BACK) : 0, off: 0, follow: stream.status === 'live' });
  const from = start.from;
  const [at, setAt] = useState(from);
  // How far in it is, in whole seconds: what the bar shows.
  const [secs, setSecs] = useState(from * stream.segment_seconds);
  const [waiting, setWaiting] = useState(false);
  // Seconds loaded past where it is.
  const [ahead, setAhead] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [over, setOver] = useState(false);
  const live = meta.status === 'live';
  const metaRef = useRef(meta);
  metaRef.current = meta;
  const playingRef = useRef(playing);
  playingRef.current = playing;
  const player = useRef<JoinedPlayer | null>(null);
  // Play was refused because nobody has pressed anything yet: the button comes back. Anything else (the video moved on while it was starting) is not a stop.
  const refused = (e: unknown) => (e as Error)?.name === 'NotAllowedError' && setPlaying(false);
  // How many times the player has given up on a live broadcast and been started again.
  const fails = useRef(0);
  // How far the stream has got, asked again while it is live.
  useEffect(() => {
    if (meta.status !== 'live') return;
    const t = window.setInterval(() => api.stream(stream.id).then(setMeta, () => (setOver(true), onGone?.())), 2000);
    return () => window.clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stream.id, meta.status]);
  useEffect(() => {
    const el = video.current;
    if (!el) return;
    const made = joinedPlayer(el, metaRef.current, from, start.follow, (p) => {
      if (p.failed) {
        // One piece that will not play (the camera changed under it, say) is no reason to watch the rest piece by piece,
        // with a stop at every join. Live, the player starts again from what comes next. Only when that keeps failing is it given up on.
        const m = metaRef.current;
        if (m.status !== 'live' || (fails.current += 1) > 4) return onFail(p.why || '');
        // From just short of the newest: past the piece that would not play, with a few seconds already there to carry on with.
        return setStart({ from: Math.max(0, m.segments - 2), off: 0, follow: true });
      }
      if (p.piece !== undefined) setAt(Math.min(p.piece, Math.max(0, metaRef.current.segments - 1)));
      if (p.at) setSecs(Math.floor((p.at.n + (p.through ?? Math.min(p.at.off / metaRef.current.segment_seconds, 0.999))) * metaRef.current.segment_seconds));
      if (p.waiting !== undefined) setWaiting(p.waiting);
      if (p.ahead !== undefined) setAhead(p.ahead);
      if (p.ended) {
        setPlaying(false);
        // A broadcast that was not saved is gone once it has played out.
        setOver(!metaRef.current.saved);
      }
    }, { offset: start.off });
    if (!made) return onFail(cannotJoin(metaRef.current));
    player.current = made;
    if (playingRef.current) el.play().catch(refused);
    return () => {
      player.current = null;
      made.close();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [start]);
  useEffect(() => player.current?.more(meta), [meta]);
  const toLive = () => {
    const n = Math.max(0, metaRef.current.segments - LIVE_BACK);
    setOver(false);
    setAt(n);
    setSecs(n * metaRef.current.segment_seconds);
    setStart({ from: n, off: 0, follow: true });
  };
  const seek = (seconds: number) => {
    const m = metaRef.current;
    // Dragged to the end of a live broadcast is asking for live.
    if (m.status === 'live' && seconds >= (m.segments - 2) * m.segment_seconds) return toLive();
    const to = markAt(seconds, m);
    setOver(false);
    setAt(to.n);
    setSecs(to.s);
    // Somewhere already loaded is simply moved to. Anywhere else, the video starts again from there.
    if (!start.follow && player.current?.seek(to)) return;
    setStart({ from: to.n, off: to.off, follow: false });
  };
  const play = () => {
    setPlaying(true);
    video.current?.play().catch(refused);
  };
  return (
    <div className="gv-player" ref={frame}>
      <div className={`gv-screen ${live ? 'live' : ''}`}>
        <video ref={video} playsInline data-n={at} data-joined="" onPlay={() => setPlaying(true)} onPause={() => video.current && !video.current.ended && setPlaying(false)} />
        {live && !over && <span className="gv-badge">LIVE</span>}
        {!playing && !over && (
          <button type="button" className="gv-play" onClick={play} aria-label="Play">
            ▶
          </button>
        )}
        {waiting && playing && !over && <span className="gv-wait">Waiting for the next few seconds…</span>}
        {over && <span className="gv-wait">This broadcast has ended.</span>}
        <FullButton full={full} onClick={toggleFull} />
      </div>
      {!over && <SeekBar at={secs} ahead={ahead} meta={meta} behind={live && !start.follow && at < meta.segments - LIVE_BACK - 2} onSeek={seek} onLive={toLive} />}
    </div>
  );
}

/** A video played piece by piece, each a small video of its own. */
function PieceVideo({ stream, onGone, why }: { stream: GameStream; onGone?: () => void; /** Why a video that could have been one is being played in pieces. */ why?: string }) {
  const video = useRef<HTMLVideoElement>(null);
  // Where the piece showing begins on the player's own clock: a piece of a joined video keeps the time it had in the whole, so it does not begin at nought.
  const base = useRef(0);
  const refused = (e: unknown) => (e as Error)?.name === 'NotAllowedError' && setPlaying(false);
  const [meta, setMeta] = useState(stream);
  const frame = useRef<HTMLDivElement>(null);
  const [full, toggleFull] = useFullScreen(frame, video);
  const [at, setAt] = useState(stream.status === 'live' ? Math.max(0, stream.segments - 2) : 0);
  // How far into the piece showing, in whole seconds, and where a piece on its way is to start from.
  const [off, setOff] = useState(0);
  const startAt = useRef(0);
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
  // Where the pieces come from is the server's to say.
  const pieces = useRef(pieceFetcher(stream)).current;
  const fetchPiece = pieces.whole;
  useEffect(() => pieces.know(meta), [pieces, meta]);
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
    fetchPiece(at)
      .then((piece) => piece ?? Promise.reject(new Error('gone')))
      .then(
        (piece) => {
          // Moved on, or left, while it was on its way.
          if (!here.current || loaded.current !== at) return;
          if (blobUrl.current) URL.revokeObjectURL(blobUrl.current);
          blobUrl.current = URL.createObjectURL(piece);
          el.setAttribute('data-n', String(at));
          el.src = blobUrl.current;
          // Starting part-way into it: set once the player knows the piece.
          const into = startAt.current;
          startAt.current = 0;
          // Not known until it plays: the first time the player gives is where this piece begins.
          base.current = -1;
          el.addEventListener(
            'loadeddata',
            () => {
              if (el.getAttribute('data-n') !== String(at) || !into) return;
              base.current = el.currentTime;
              el.currentTime = base.current + into;
            },
            { once: true },
          );
          if (playingRef.current) el.play().catch(refused);
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
  // Watching live, kept near the newest. Going back through a live broadcast turns it off.
  const [follow, setFollow] = useState(stream.status === 'live');
  const followRef = useRef(follow);
  followRef.current = follow;
  const next = () => {
    const m = metaRef.current;
    startAt.current = 0;
    setOff(0);
    // Fallen far behind a live stream while watching it live: jump back near the front.
    setAt((n) => (m.status === 'live' && followRef.current && m.segments - n > 6 ? m.segments - 2 : n + 1));
  };
  const toLive = () => {
    setOver(false);
    setFollow(true);
    startAt.current = 0;
    setOff(0);
    setAt(Math.max(0, metaRef.current.segments - 2));
  };
  const seek = (seconds: number) => {
    const m = metaRef.current;
    if (m.status === 'live' && seconds >= (m.segments - 2) * m.segment_seconds) return toLive();
    const to = markAt(seconds, m);
    const el = video.current;
    setOver(false);
    setFollow(false);
    setOff(to.off);
    // Within the piece that is showing, it is simply moved. Another piece starts from there once it is in.
    if (el && to.n === at && el.getAttribute('data-n') === String(at)) el.currentTime = to.off;
    else startAt.current = to.off;
    setAt(to.n);
  };
  const onTime = () => {
    const el = video.current;
    if (!el || el.getAttribute('data-n') !== String(at) || startAt.current) return;
    // Where this piece begins on the player's clock, which is not nought for a piece of a joined video.
    // The player says nought as a piece loads, and only then where the piece really begins.
    if (base.current < 0) {
      if (el.currentTime === 0) return setOff(0);
      base.current = el.currentTime;
    }
    setOff(Math.max(0, Math.min(Math.floor(el.currentTime - base.current), meta.segment_seconds - 1)));
  };
  const play = () => {
    setPlaying(true);
    video.current?.play().catch(refused);
  };
  return (
    <div className="gv-player" ref={frame}>
      <div className={`gv-screen ${live ? 'live' : ''}`}>
        <video ref={video} playsInline onEnded={next} onError={next} onTimeUpdate={onTime} onPlay={() => setPlaying(true)} onPause={() => video.current && !video.current.ended && setPlaying(false)} />
        {live && !over && <span className="gv-badge">LIVE</span>}
        {!playing && !over && (
          <button type="button" className="gv-play" onClick={play} aria-label="Play">
            ▶
          </button>
        )}
        {waiting && playing && <span className="gv-wait">Waiting for the next few seconds…</span>}
        {over && <span className="gv-wait">This broadcast has ended.</span>}
        <FullButton full={full} onClick={toggleFull} />
      </div>
      {!over && <SeekBar at={at * meta.segment_seconds + off} meta={meta} behind={live && !follow && at < meta.segments - 3} onSeek={seek} onLive={toLive} />}
      {why && <p className="muted small gv-why">Playing a few seconds at a time, with a short stop between, because {why}.</p>}
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

/** A small picture from early in a video file, to show the video by. Null when this browser cannot show the file. */
function pictureOf(file: File): Promise<Blob | null> {
  return new Promise((done) => {
    const el = document.createElement('video');
    const url = URL.createObjectURL(file);
    const end = (b: Blob | null) => {
      window.clearTimeout(timer);
      el.removeAttribute('src');
      el.load();
      URL.revokeObjectURL(url);
      done(b);
    };
    const timer = window.setTimeout(() => end(null), 8000);
    el.muted = true;
    el.playsInline = true;
    el.preload = 'auto';
    el.onerror = () => end(null);
    el.onloadeddata = () => (el.currentTime = Math.min(2, (el.duration || 0) / 2));
    el.onseeked = () => {
      if (!el.videoWidth) return end(null);
      const c = document.createElement('canvas');
      c.width = 480;
      c.height = Math.round((480 * el.videoHeight) / el.videoWidth);
      c.getContext('2d')?.drawImage(el, 0, 0, c.width, c.height);
      c.toBlob((b) => end(b), 'image/jpeg', 0.72);
    };
    el.src = url;
  });
}

/**
 * Brings a video file from this device in as a saved video of a game. The file is cut into
 * pieces here and sent a piece at a time, so the page has to stay open until it is done.
 */
function BringIn({ teamId, planId, title, onDone }: { teamId: number; planId?: number; title: string; onDone: (note: string) => void }) {
  const input = useRef<HTMLInputElement>(null);
  const [going, setGoing] = useState<(Bringing & { name: string }) | null>(null);
  const [error, setError] = useState('');
  // What is under way: stopped, and the stream thrown away, when it is cancelled or the page is left.
  const job = useRef<{ stop: boolean; id: number } | null>(null);
  const giveUp = () => {
    const j = job.current;
    job.current = null;
    if (!j) return;
    j.stop = true;
    if (j.id) api.endStream(j.id, false).catch(() => {});
  };
  useEffect(() => giveUp, []);
  useEffect(() => {
    if (!going) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [!!going]);
  const bring = async (file: File) => {
    const j = { stop: false, id: 0 };
    job.current = j;
    setError('');
    setGoing({ sent: 0, of: 0, name: file.name });
    const picture = pictureOf(file);
    try {
      const today = new Date();
      const date = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
      const stream = await bringInVideo(
        file,
        async (mime) => {
          const r = await api.startStream({ team_id: teamId, plan_id: planId, title: title || (planId ? '' : file.name.replace(/\.[^.]+$/, '')), mime, date, layout: 'joined', upload: true });
          j.id = r.stream.id;
          // Cancelled while the server was being asked.
          if (j.stop) api.endStream(j.id, false).catch(() => {});
          return r;
        },
        (b) => !j.stop && setGoing({ ...b, name: file.name }),
        () => j.stop,
      );
      const shot = await picture;
      if (shot) await api.sendPoster(stream.id, shot);
      const r = await api.endStream(stream.id, true);
      j.id = 0;
      job.current = null;
      setGoing(null);
      const game = stream.game ? `${stream.game.title || 'this game'}${stream.game.date ? ` (${stream.game.date})` : ''}` : '';
      onDone(r.saved ? `The video was added${game ? ` to ${game}` : ', not tied to a game'}. It is in the Filmroom too, where it can be cut into clips.` : 'The video could not be kept: saving video is not turned on for this team.');
    } catch (e) {
      if (job.current === j) giveUp();
      setGoing(null);
      if (!(e instanceof Stopped)) setError((e as Error).message);
    }
  };
  const share = going && going.of > 0 ? going.sent / going.of : 0;
  return (
    <div className="gv-bring">
      <input
        ref={input}
        type="file"
        accept="video/mp4,video/quicktime,.mp4,.m4v,.mov"
        hidden
        onChange={(e) => {
          const f = e.target.files?.[0];
          e.target.value = '';
          if (f) bring(f);
        }}
      />
      {going ? (
        <div className="gv-bring-going" role="status">
          <span>
            <strong>{going.name}</strong> <span className="muted small">{going.of === 0 ? 'Reading the video…' : `${Math.floor(share * 100)}% sent. Keep this page open until it is done.`}</span>
          </span>
          <progress max={1} value={going.of === 0 ? undefined : share} />
          <button type="button" className="btn small" onClick={giveUp}>
            Cancel
          </button>
        </div>
      ) : (
        <div className="gv-actions">
          <button type="button" className="btn" onClick={() => input.current?.click()}>
            Add a video from this device
          </button>
          <span className="muted small">An MP4 or MOV file, as phones and cameras make. It is added as it is, and can be cut into clips like one recorded here.</span>
        </div>
      )}
      {error && <p className="error">{error}</p>}
    </div>
  );
}

/**
 * One saved video as a card, the way Resources shows its things: a picture from the game to
 * press and play, what it is, and what can be done with it (`children`).
 */
export function GameVideoCard({ stream: s, onPlay, playLabel = 'Play', children }: { stream: GameStream; onPlay: () => void; playLabel?: string; children?: ReactNode }) {
  return (
    <div className="res-card kind-video game-video">
      <button type="button" className="res-preview" onClick={onPlay} title="Play">
        {s.has_poster ? (
          <img className="res-thumb gv-poster" src={`/api/streams/${s.id}/poster`} alt="" loading="lazy" />
        ) : (
          <span className="res-thumb site">
            <svg viewBox="0 0 24 24" width="26" height="26" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M3.5 7h11v10h-11zM14.5 10.500l6-3v9l-6-3" />
            </svg>
            Game video
          </span>
        )}
        <span className="res-play" aria-hidden="true">
          ▶
        </span>
        <span className="gv-length">{span(s.seconds)}</span>
      </button>
      <div className="res-info">
        <strong className="res-title">{s.title || 'Game video'}</strong>
        <span className="muted small">
          {day(s.started_at)} · {mb(s.bytes)} · from {s.by}
        </span>
        <div className="res-actions">
          {playLabel === 'Play' ? (
            <button type="button" className="btn small icon-btn" onClick={onPlay} aria-label={`Play ${s.title || 'Game video'}`} title="Play">
              <PlayIcon />
            </button>
          ) : (
            <button type="button" className="btn small" onClick={onPlay}>
              {playLabel}
            </button>
          )}
          {children}
        </div>
      </div>
    </div>
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
  const [watching, setWatching] = useState<GameStream | null>(null);
  const remove = async (v: GameStream) => {
    if (!(await confirmDialog({ title: 'Delete this video?', body: `${v.title || 'Game video'}, ${day(v.started_at)}. It is gone for good, and its ${mb(v.bytes)} is freed.`, confirmLabel: 'Delete', danger: true }))) return;
    api.deleteStream(v.id).then(load, () => {});
  };
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
          {/* Going live from this device: at the top right of the page, where it is found without reading down. */}
          {can.broadcast && (
            <div className="gv-top">
              <button type="button" className="btn gv-go" title="Uses this device's camera and microphone. You choose whether the video is kept before you go live." onClick={() => (setNotice(''), setCasting(true))}>
                <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M12 14a2 2 0 1 0 0-4 2 2 0 0 0 0 4ZM8.1 15.9a5.5 5.5 0 0 1 0-7.800M15.9 8.100a5.500 5.500 0 0 1 0 7.800M5.300 18.700a9.500 9.500 0 0 1 0-13.400M18.700 5.300a9.500 9.500 0 0 1 0 13.400" />
                </svg>
                Broadcast from this device
              </button>
            </div>
          )}
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
        </>
      )}
      {can.coach && !casting && (
        <div className="card">
          <h2>Saved video{planId ? ' of this game' : ''}</h2>
          <p className="muted small">
            For this team's coaches. It is also in the Filmroom, where it can be cut into clips. {can.save ? '' : 'Saving video is not turned on for this team: the administrator decides which teams may keep video.'}
            {list.free_bytes !== undefined && Number.isFinite(list.free_bytes) && ` The site has ${mb(list.free_bytes)} of room left.`}
          </p>
          {saved.length === 0 ? (
            <p className="muted">No saved video yet.</p>
          ) : (
            <div className="res-grid gv-saved">
              {saved.map((s) => (
                <GameVideoCard key={s.id} stream={s} onPlay={() => setWatching(s)}>
                  <button type="button" className="btn small icon-btn danger res-remove" aria-label={`Delete ${s.title || 'Game video'}`} title="Delete" onClick={() => remove(s)}>
                    <BinIcon />
                  </button>
                </GameVideoCard>
              ))}
            </div>
          )}
          {can.save && (
            <BringIn
              teamId={teamId}
              planId={planId}
              title={title}
              onDone={(note) => {
                setNotice(note);
                load();
              }}
            />
          )}
        </div>
      )}
      {watching && (
        <Modal title={watching.title || 'Game video'} onClose={() => setWatching(null)} wide>
          <StreamPlayer stream={watching} />
          <p className="muted small">
            {day(watching.started_at)} · {span(watching.seconds)} · from {watching.by}
          </p>
        </Modal>
      )}
    </div>
  );
}
