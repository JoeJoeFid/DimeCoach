// How live video leaves this device, and how it is fetched and played.
//
// The pages that show video know nothing of where it is kept. The server says how a broadcast is
// to be sent (`send`) and how a stream is to be watched (`watch`), and what is here does it:
//
//   'server'  each piece goes to, and comes from, the site itself.
//   'links'   the site hands out short-lived links, and each piece goes straight to, and comes
//             straight from, where the video is kept.
//
// The pieces come in one of two layouts (server/streams.js says more):
//
//   'joined'    one recording that never stops, cut cleanly (mp4boxes.ts), played as one unbroken
//               video. Used whenever this browser's recorder puts out video that can be cut.
//   'separate'  each piece recorded on its own and played on its own. A moment is lost at every
//               join. What every browser can do, and what older saved video is.
//
// A broadcast is always the same three things to the page: start it, stop it, and hear how it
// is getting on. Another way of broadcasting later would be another `Broadcaster`.
import { api, type GameStream } from './api';
import { cutter } from './mp4boxes';

/** How a broadcast is getting on: pieces that have gone out, and pieces still waiting to. */
export interface Signal {
  sent: number;
  behind: number;
  /** Set when the broadcast cannot go on: it was ended elsewhere, or has run as long as it may. */
  error?: string;
}
export interface Broadcaster {
  start: () => void;
  /** Stops the camera's recording. Waits for what is still waiting to go out, unless told not to. */
  stop: (wait?: boolean) => Promise<void>;
  /** The whole broadcast as one video file, once it has stopped, when it was asked to keep one on this device. */
  recording: () => Blob | null;
}
/** How the server said to send a broadcast's pieces. */
export type SendHow = 'server' | 'links';
export type Layout = 'joined' | 'separate';

const RECORDING = { videoBitsPerSecond: 700_000, audioBitsPerSecond: 48_000 };

// ---------- Sending ----------

class Refused extends Error {}
interface Sender {
  /** Sends the opening part of a joined video. */
  init: (part: Blob) => Promise<void>;
  /** Sends piece `n`. Returns how many pieces the server now has. */
  piece: (n: number, piece: Blob) => Promise<number>;
}
// Either throws `Refused` when the broadcast cannot go on, and anything else when it is worth trying again.

const refusals = /ended|longest|room/;
const toServer = (id: number): Sender => {
  const post = async (piece: Blob, init: boolean) => {
    try {
      await api.sendSegment(id, piece, init);
    } catch (e) {
      throw refusals.test((e as Error).message) ? new Refused((e as Error).message) : e;
    }
  };
  return { init: (part) => post(part, true), piece: (n, piece) => post(piece, false).then(() => n + 1) };
};
const byLinks = (id: number, type: string): Sender => {
  // Links are asked for a few at a time, ahead of the pieces they are for.
  let links = new Map<number, string>();
  const ask = async () => {
    const r = await api.sendLinks(id);
    if (r.status === 400 || r.status === 404) throw new Refused(r.error || 'This broadcast has ended.');
    if (!r.links?.length) throw new Error(r.error || 'No links');
    links = new Map(r.links.map((l) => [l.n, l.url]));
    return r;
  };
  const put = async (url: string, body: Blob) => {
    const res = await fetch(url, { method: 'PUT', headers: { 'Content-Type': type }, body });
    if (res.ok) return;
    // A link that has run out, or been refused: the next try asks for fresh ones.
    links.clear();
    throw new Error(`The video store answered ${res.status}`);
  };
  const ended = (said: { status: number; error?: string }) => said.status === 404 || (said.status === 400 && refusals.test(said.error || ''));
  return {
    init: async (part) => {
      const r = await ask();
      // No link for it means it is already there.
      if (!r.init) return;
      await put(r.init, part);
      const said = await api.sentPiece(id, 'init');
      if (ended(said)) throw new Refused(said.error || 'This broadcast has ended.');
      if (said.status !== 200) throw new Error(said.error || 'Not counted');
    },
    piece: async (n, piece) => {
      if (!links.has(n)) {
        const r = await ask();
        // The server counts the pieces. Where this device has lost count, it carries on from the server's.
        if (!links.has(n)) n = r.links![0].n;
      }
      await put(links.get(n)!, piece);
      const said = await api.sentPiece(id, n);
      if (ended(said)) throw new Refused(said.error || 'This broadcast has ended.');
      // Too large to keep: this piece is let go and the broadcast carries on.
      if (said.status === 413) return n;
      if (said.status !== 200 || typeof said.segments !== 'number') {
        links.clear();
        throw new Error(said.error || 'Not counted');
      }
      return said.segments;
    },
  };
};

/** What is waiting to go out, sent oldest first and one at a time, whatever made it. */
function outbox(stream: GameStream, how: SendHow, type: string, onSignal: (s: Signal) => void, onRefused: () => void) {
  const send = how === 'links' ? byLinks(stream.id, type.split(';')[0]) : toServer(stream.id);
  const st = { init: null as Blob | null, queue: [] as Blob[], sending: false, sent: 0, next: 0, dead: false };
  const tell = (error?: string) => onSignal({ sent: st.sent, behind: st.queue.length, error });
  const pump = async () => {
    if (st.sending) return;
    st.sending = true;
    while ((st.init || st.queue.length > 0) && !st.dead) {
      try {
        if (st.init) {
          await send.init(st.init);
          st.init = null;
          continue;
        }
        const now = await send.piece(st.next, st.queue[0]);
        st.queue.shift();
        st.next = now;
        st.sent += 1;
      } catch (e) {
        if (e instanceof Refused) {
          st.dead = true;
          st.queue = [];
          tell(e.message);
          onRefused();
          break;
        }
        // Anything else is the connection: try again shortly.
        await new Promise((r) => setTimeout(r, 1500));
      }
      // Too far behind means the connection cannot keep up: the oldest pieces are dropped so the viewers stay near live.
      while (st.queue.length > 8) st.queue.shift();
      tell();
    }
    st.sending = false;
  };
  return {
    /** The opening part of a joined video, which goes before any piece. */
    init: (part: Blob) => {
      st.init = part;
      pump();
    },
    push: (piece: Blob) => {
      if (st.dead) return;
      st.queue.push(piece);
      tell();
      pump();
    },
    /** Gives what is waiting a few seconds to go out, then lets the rest go. */
    drain: async (wait: boolean) => {
      for (let i = 0; wait && i < 20 && (st.init || st.queue.length > 0 || st.sending) && !st.dead; i++) await new Promise((r) => setTimeout(r, 300));
      st.dead = true;
      st.queue = [];
    },
  };
}

// ---------- Broadcasting ----------

/**
 * Broadcasts a camera a few seconds at a time, each piece a small video file of its own. The
 * camera is asked for afresh for every piece, so it can be turned around between them.
 */
export function pieceBroadcaster(camera: () => MediaStream | null, stream: GameStream, how: SendHow, type: string, onSignal: (s: Signal) => void, keep = false): Broadcaster {
  const st = { on: false, timer: 0, recorder: null as MediaRecorder | null };
  // Separate pieces do not add up to one file, so a copy for this device is recorded beside them, without stopping.
  const copy = { recorder: null as MediaRecorder | null, parts: [] as Blob[] };
  const out = outbox(stream, how, type, onSignal, () => (st.on = false));
  /** Records one piece, and starts the next as this one ends, for as long as the broadcast is on. */
  const record = () => {
    const m = camera();
    if (!st.on || !m) return;
    const rec = new MediaRecorder(m, { mimeType: type, ...RECORDING });
    st.recorder = rec;
    rec.ondataavailable = (e) => e.data.size > 0 && out.push(e.data);
    rec.start();
    st.timer = window.setTimeout(() => {
      // The next piece starts before this one stops, so as little as can be falls between them.
      record();
      if (rec.state !== 'inactive') rec.stop();
    }, stream.segment_seconds * 1000);
  };
  return {
    start: () => {
      st.on = true;
      record();
      const m = camera();
      if (keep && m) {
        copy.recorder = new MediaRecorder(m, { mimeType: type, ...RECORDING });
        copy.recorder.ondataavailable = (e) => e.data.size > 0 && copy.parts.push(e.data);
        copy.recorder.start(4000);
      }
    },
    stop: async (wait = true) => {
      st.on = false;
      window.clearTimeout(st.timer);
      if (st.recorder && st.recorder.state !== 'inactive') st.recorder.stop();
      const c = copy.recorder;
      if (c && c.state !== 'inactive') await new Promise<void>((done) => ((c.onstop = () => done()), c.stop()));
      // The last piece is given a moment to arrive.
      if (wait) await new Promise((r) => setTimeout(r, 400));
      await out.drain(wait);
    },
    recording: () => (copy.parts.length ? new Blob(copy.parts, { type: type.split(';')[0] }) : null),
  };
}

/** A broadcast that is ready to begin: which layout this browser can record, found by trying. */
export interface Opening {
  layout: Layout;
  /** Begins sending, once the server has made the stream and said how. `keep` also keeps the whole of it as one file on this device. */
  begin: (stream: GameStream, how: SendHow, onSignal: (s: Signal) => void, keep?: boolean) => Broadcaster;
  /** Lets go of the camera's recording when the broadcast is not going ahead after all. */
  cancel: () => void;
}
/** How long a recorder is given to show that what it puts out can be cut. */
const PROBE_MS = 5000;

/**
 * Starts recording the camera without stopping, and sees whether what comes out can be cut into
 * pieces that join up. When it can, that recording is the broadcast, from this moment. When it
 * cannot (another kind of file, or a browser that writes MP4 the old way), the broadcast is made
 * of separate pieces as before. Either way the page is told which, and begins it the same.
 */
export function openBroadcast(camera: () => MediaStream | null, type: string): Promise<Opening> {
  const separate: Opening = { layout: 'separate', begin: (stream, how, onSignal, keep) => pieceBroadcaster(camera, stream, how, type, onSignal, keep), cancel: () => {} };
  const m = camera();
  if (!m || !type.startsWith('video/mp4')) return Promise.resolve(separate);
  let rec: MediaRecorder;
  try {
    // A fresh start for the picture every two seconds, where the browser will: a piece can only begin at one.
    rec = new MediaRecorder(m, { mimeType: type, ...RECORDING, videoKeyFrameIntervalDuration: 2000 } as MediaRecorderOptions);
  } catch {
    return Promise.resolve(separate);
  }
  const cut = cutter();
  const mp4 = type.split(';')[0];
  const st = { init: null as Blob | null, parts: [] as Uint8Array[], cutAt: Date.now(), out: null as ReturnType<typeof outbox> | null, seconds: 4 };
  // The copy for this device, when one is wanted: the opening part and every fragment, which together are one video file.
  // It has everything, even pieces that were dropped on the way out because the connection was slow.
  let kept: Blob[] | null = null;
  let known: (fit: boolean) => void = () => {};
  /** Hands on what has been gathered as one piece. */
  const flush = () => {
    if (!st.out || st.parts.length === 0) return;
    st.out.push(new Blob(st.parts as BlobPart[], { type: mp4 }));
    st.parts = [];
    st.cutAt = Date.now();
  };
  // Lumps are read one after another, in the order they came.
  let reading: Promise<void> = Promise.resolve();
  rec.ondataavailable = (e) => {
    reading = reading.then(async () => {
      for (const c of cut(new Uint8Array(await e.data.arrayBuffer()))) {
        if (c.kind === 'unfit') known(false);
        else if (c.kind === 'init') {
          st.init = new Blob([c.bytes as BlobPart], { type: mp4 });
          known(true);
        } else {
          kept?.push(new Blob([c.bytes as BlobPart]));
          st.parts.push(c.bytes);
          // A piece is whole fragments, cut once enough time has gone by.
          if (Date.now() - st.cutAt >= st.seconds * 1000 - 500) flush();
        }
      }
    });
  };
  const halt = () => new Promise<void>((done) => {
    if (rec.state === 'inactive') return done();
    rec.onstop = () => done();
    rec.stop();
  });
  rec.start(1000);
  return new Promise<Opening>((resolve) => {
    const timer = window.setTimeout(() => known(false), PROBE_MS);
    known = (fit) => {
      known = () => {};
      window.clearTimeout(timer);
      if (!fit) {
        halt();
        return resolve(separate);
      }
      resolve({
        layout: 'joined',
        cancel: () => void halt(),
        begin: (stream, how, onSignal, keep) => {
          if (keep) kept = [st.init!, ...st.parts.map((p) => new Blob([p as BlobPart]))];
          st.seconds = stream.segment_seconds;
          st.cutAt = Date.now();
          st.out = outbox(stream, how, type, onSignal, () => void halt());
          st.out.init(st.init!);
          return {
            // It has been recording since it was opened.
            start: () => {},
            stop: async (wait = true) => {
              await halt();
              // What the recorder had left comes out as it stops, and goes as the last piece.
              await new Promise((r) => setTimeout(r, 100));
              await reading;
              if (wait) flush();
              await st.out!.drain(wait);
            },
            recording: () => (kept && kept.length > 1 ? new Blob(kept, { type: mp4 }) : null),
          };
        },
      });
    };
  });
}

// ---------- Watching ----------

/** Fetches a stream's pieces to be played. Each gives null for what cannot be had, which the player steps over. */
export interface Pieces {
  piece: (n: number) => Promise<Blob | null>;
  /** The opening part of a joined video. */
  init: () => Promise<Blob | null>;
  /** A piece as a video file that plays on its own: for a joined video, its opening part and then the piece. */
  whole: (n: number) => Promise<Blob | null>;
}
export function pieceFetcher(stream: GameStream): Pieces {
  let type = stream.mime.split(';')[0];
  let piece: Pieces['piece'];
  let init: Pieces['init'];
  if (stream.watch !== 'links') {
    const from = (what: number | 'init') => fetch(`/api/streams/${stream.id}/segments/${what}`).then((r) => (r.ok ? r.blob() : null));
    piece = from;
    init = () => from('init');
  } else {
    // Links are asked for a few at a time, and again once they are near running out.
    const links = new Map<number | 'init', { url: string; until: number }>();
    const get = async (n: number | 'init') => {
      let link = links.get(n);
      if (!link || link.until < Date.now()) {
        const r = await api.watchLinks(stream.id, n === 'init' ? 0 : n);
        type = r.type || type;
        const until = Date.now() + (r.good_for - 30) * 1000;
        for (const l of r.links) links.set(l.n, { url: l.url, until });
        if (r.init) links.set('init', { url: r.init, until });
        link = links.get(n);
        if (!link) return null;
      }
      const res = await fetch(link.url);
      if (!res.ok) {
        links.delete(n);
        return null;
      }
      // The kind of video is the stream's, whatever the store says it is.
      return new Blob([await res.arrayBuffer()], { type });
    };
    piece = get;
    init = () => get('init');
  }
  if (stream.layout !== 'joined') return { piece, init: async () => null, whole: piece };
  // The opening part never changes, so it is fetched once.
  let opening: Promise<Blob | null> | null = null;
  const once = () => (opening ??= init().then((b) => b ?? ((opening = null), null), () => ((opening = null), null)));
  return {
    piece,
    init: once,
    whole: async (n) => {
      const [a, b] = await Promise.all([once(), piece(n)]);
      return a && b ? new Blob([a, b], { type }) : null;
    },
  };
}

/** What a joined video's player has to say as it plays. */
export interface Playing {
  /** The piece now showing. */
  piece?: number;
  /** Caught up with a live stream, and waiting for more. */
  waiting?: boolean;
  /** A saved video has played to its end. */
  ended?: boolean;
  /** This browser could not play it this way after all: the page falls back to playing piece by piece. */
  failed?: boolean;
}
export interface JoinedPlayer {
  /** How far the stream has got, told again as it grows. */
  more: (stream: GameStream) => void;
  close: () => void;
}
/** How much is kept ready ahead of what is showing, in pieces, and how much is kept behind, in seconds. */
const AHEAD_PIECES = 3;
const KEEP_BEHIND = 30;

/** The name a browser's player wants for this kind of video. */
function sourceType(mime: string) {
  const codecs = /codecs="?([^";]+)"?/.exec(mime)?.[1] ?? 'avc1.42E01E,mp4a.40.2';
  return `video/mp4; codecs="${codecs}"`;
}

/**
 * Plays a joined video from piece `from` on, as one unbroken video: the pieces are fed to the
 * browser's player one after another and it plays across the joins as if there were none. A
 * missing piece closes up. Gives null when this browser has no such player (older iPhones), and
 * the page plays piece by piece.
 */
export function joinedPlayer(el: HTMLVideoElement, stream: GameStream, from: number, onChange: (p: Playing) => void): JoinedPlayer | null {
  const w = window as unknown as { ManagedMediaSource?: typeof MediaSource; MediaSource?: typeof MediaSource };
  const Source = w.ManagedMediaSource ?? w.MediaSource;
  const mime = sourceType(stream.mime);
  if (!Source || !Source.isTypeSupported(mime)) return null;
  const get = pieceFetcher(stream);
  const seconds = stream.segment_seconds;
  const st = { next: from, segments: stream.segments, live: stream.status === 'live', busy: false, closed: false, sb: null as SourceBuffer | null };
  const ms = new Source();
  const url = URL.createObjectURL(ms);
  // An iPhone's player asks for this before it will take video fed to it.
  if (w.ManagedMediaSource) (el as HTMLVideoElement & { disableRemotePlayback: boolean }).disableRemotePlayback = true;
  el.src = url;
  const fail = () => !st.closed && onChange({ failed: true });
  /** Resolves when the player has taken what it was just given. */
  const settled = (sb: SourceBuffer) =>
    new Promise<void>((ok, no) => {
      const done = () => (off(), ok());
      const bad = () => (off(), no(new Error('The player would not take the video')));
      const off = () => (sb.removeEventListener('updateend', done), sb.removeEventListener('error', bad));
      sb.addEventListener('updateend', done);
      sb.addEventListener('error', bad);
    });
  const give = async (sb: SourceBuffer, part: Blob) => {
    const taken = settled(sb);
    sb.appendBuffer(await part.arrayBuffer());
    await taken;
  };
  const ahead = (sb: SourceBuffer) => (sb.buffered.length ? sb.buffered.end(sb.buffered.length - 1) - el.currentTime : 0);
  /** Feeds the player what it has room for, and lets go of what is long past. */
  const fill = async () => {
    const sb = st.sb;
    if (st.closed || st.busy || !sb) return;
    st.busy = true;
    try {
      if (sb.buffered.length && sb.buffered.start(0) < el.currentTime - 2 * KEEP_BEHIND) {
        const gone = settled(sb);
        sb.remove(0, el.currentTime - KEEP_BEHIND);
        await gone;
      }
      // Fallen far behind a live stream: step over to near the front.
      if (st.live && st.segments - st.next > 6) st.next = st.segments - 2;
      while (!st.closed && st.next < st.segments && ahead(sb) < AHEAD_PIECES * seconds) {
        let part: Blob | null;
        try {
          part = await get.piece(st.next);
        } catch {
          // The connection: tried again on the next turn.
          return;
        }
        if (st.closed) return;
        if (part) await give(sb, part);
        st.next += 1;
      }
      // A video that is over is told so, and plays out what it has.
      if (!st.live && st.next >= st.segments && ms.readyState === 'open' && !sb.updating) ms.endOfStream();
    } catch {
      fail();
    } finally {
      st.busy = false;
    }
  };
  const opened = window.setTimeout(() => !st.sb && fail(), 6000);
  ms.addEventListener(
    'sourceopen',
    async () => {
      try {
        const sb = ms.addSourceBuffer(mime);
        // Each piece follows the last, whatever times are written inside it: a piece that never arrived leaves no hole.
        sb.mode = 'sequence';
        const opening = await get.init();
        if (st.closed) return;
        if (!opening) return void fail();
        await give(sb, opening);
        st.sb = sb;
        fill();
      } catch {
        fail();
      }
    },
    { once: true },
  );
  const timer = window.setInterval(fill, 500);
  const onTime = () => onChange({ piece: from + Math.floor(el.currentTime / seconds) });
  const onWaiting = () => onChange({ waiting: st.live && st.next >= st.segments });
  const onPlaying = () => onChange({ waiting: false });
  const onEnded = () => onChange({ ended: true });
  el.addEventListener('timeupdate', onTime);
  el.addEventListener('waiting', onWaiting);
  el.addEventListener('playing', onPlaying);
  el.addEventListener('ended', onEnded);
  return {
    more: (s) => {
      st.segments = s.segments;
      st.live = s.status === 'live';
      fill();
    },
    close: () => {
      st.closed = true;
      window.clearTimeout(opened);
      window.clearInterval(timer);
      el.removeEventListener('timeupdate', onTime);
      el.removeEventListener('waiting', onWaiting);
      el.removeEventListener('playing', onPlaying);
      el.removeEventListener('ended', onEnded);
      el.pause();
      el.removeAttribute('src');
      el.load();
      URL.revokeObjectURL(url);
    },
  };
}
