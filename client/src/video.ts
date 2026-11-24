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
// A broadcast is always the same few things to the page: start it, stop it, change its quality,
// and hear how it is getting on. Another way of broadcasting later would be another `Broadcaster`.
import { api, type GameStream } from './api';
import { cutter } from './mp4boxes';
import { Unfit, fileSource, prepareVideo } from './mp4file';

/** How a broadcast is getting on: pieces that have gone out, and pieces still waiting to. */
export interface Signal {
  sent: number;
  behind: number;
  /** Set when the broadcast cannot go on: it was ended elsewhere, or has run as long as it may. */
  error?: string;
}
/**
 * How sharp the picture is. Sharper needs a better connection, and makes a bigger video. The
 * sizes are ones cameras take pictures at: a recording comes out at the camera's own size, so a
 * size in between (540p, say) would be recorded at the next one up whatever was asked for.
 */
export type Quality = 'low' | 'medium' | 'high';
export const QUALITIES: Record<Quality, { label: string; says: string; width: number; height: number; video: number; audio: number }> = {
  low: { label: 'Low', says: '360p. For a weak connection.', width: 640, height: 360, video: 700_000, audio: 48_000 },
  medium: { label: 'Medium', says: '720p. A good balance.', width: 1280, height: 720, video: 1_800_000, audio: 64_000 },
  high: { label: 'High', says: '1080p. Needs a strong connection.', width: 1920, height: 1080, video: 4_000_000, audio: 64_000 },
};
/** What to ask a camera for at a quality. A camera that cannot do it gives the nearest it can. */
export const cameraSize = (q: Quality) => ({ width: { ideal: QUALITIES[q].width }, height: { ideal: QUALITIES[q].height } });
const resize = (m: MediaStream | null, q: Quality) => m?.getVideoTracks()[0]?.applyConstraints(cameraSize(q)).catch(() => {}) ?? Promise.resolve();
const bits = (q: Quality) => ({ videoBitsPerSecond: QUALITIES[q].video, audioBitsPerSecond: QUALITIES[q].audio });

export interface Broadcaster {
  start: () => void;
  /** Stops the camera's recording. Waits for what is still waiting to go out, unless told not to. */
  stop: (wait?: boolean) => Promise<void>;
  /** Changes how sharp the picture is, from here on, without ending the broadcast. */
  quality: (q: Quality) => Promise<void>;
  /**
   * The whole broadcast as a video file, once it has stopped, when it was asked to keep one on
   * this device. More than one file when the quality was changed along the way: a video file is
   * one size of picture from start to end, so each change begins a new one.
   */
  recording: () => Blob[];
}
/** How the server said to send a broadcast's pieces. */
export type SendHow = 'server' | 'links';
export type Layout = 'joined' | 'separate';

// ---------- Sending ----------

class Refused extends Error {}
interface Sender {
  /** Sends an opening part of a joined video: the one the pieces after it carry on from. */
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
  const ask = async (init = false) => {
    const r = await api.sendLinks(id, init);
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
      const r = await ask(true);
      if (!r.init) throw new Error('No link for the opening part');
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

/** What is waiting to go out, sent in the order it was made and one at a time, whatever made it. */
function outbox(stream: GameStream, how: SendHow, type: string, onSignal: (s: Signal) => void, onRefused: () => void) {
  const send = how === 'links' ? byLinks(stream.id, type.split(';')[0]) : toServer(stream.id);
  const st = { queue: [] as { init: boolean; blob: Blob }[], sending: false, sent: 0, next: 0, dead: false };
  const waiting = () => st.queue.filter((q) => !q.init).length;
  const tell = (error?: string) => onSignal({ sent: st.sent, behind: waiting(), error });
  const pump = async () => {
    if (st.sending) return;
    st.sending = true;
    while (st.queue.length > 0 && !st.dead) {
      const item = st.queue[0];
      try {
        if (item.init) await send.init(item.blob);
        else {
          st.next = await send.piece(st.next, item.blob);
          st.sent += 1;
        }
        st.queue.shift();
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
      // An opening part is never dropped: the pieces after it cannot be played without it.
      while (waiting() > 8) st.queue.splice(st.queue.findIndex((q) => !q.init), 1);
      tell();
    }
    st.sending = false;
  };
  const add = (init: boolean, blob: Blob) => {
    if (st.dead) return;
    st.queue.push({ init, blob });
    tell();
    pump();
  };
  return {
    /** An opening part of a joined video, which goes before the pieces made after it. */
    init: (part: Blob) => add(true, part),
    push: (piece: Blob) => add(false, piece),
    /** Gives what is waiting a few seconds to go out, then lets the rest go. */
    drain: async (wait: boolean) => {
      for (let i = 0; wait && i < 20 && (st.queue.length > 0 || st.sending) && !st.dead; i++) await new Promise((r) => setTimeout(r, 300));
      st.dead = true;
      st.queue = [];
    },
  };
}

// ---------- Bringing in a video file ----------

/** How long each piece of a video is, which is the server's to say (SEGMENT_SECONDS) but has to be known before it is asked. */
const PIECE_SECONDS = 4;
/** Bringing a video in was stopped by the person doing it. */
export class Stopped extends Error {}
/** How bringing a video in is getting on. Nothing has been sent while `of` is 0: the file is still being read. */
export interface Bringing {
  sent: number;
  of: number;
}
/**
 * Brings a video file in as a game video. The file is cut here into the pieces a recorded video
 * is made of (mp4file.ts), with nothing decoded or made again, and they are sent the way a
 * broadcast's are. `begin` asks the server for the stream once it is known what kind of video it
 * is. Unlike a broadcast, no piece is ever dropped: one that will not go is tried until it does,
 * or until it is plain the connection is gone. Throws `Unfit` for a file that cannot be brought
 * in, with why, and `Stopped` when `stopped` says to give up.
 */
export async function bringInVideo(
  file: Blob,
  begin: (mime: string) => Promise<{ stream: GameStream; send: SendHow; max_piece_bytes?: number }>,
  onChange: (b: Bringing) => void,
  stopped: () => boolean,
): Promise<GameStream> {
  onChange({ sent: 0, of: 0 });
  const video = await prepareVideo(fileSource(file), PIECE_SECONDS);
  // A video this browser could not play would be no use to the person bringing it in.
  const w = window as unknown as { ManagedMediaSource?: typeof MediaSource; MediaSource?: typeof MediaSource };
  const Source = w.ManagedMediaSource ?? w.MediaSource;
  if (Source && !Source.isTypeSupported(sourceType(video.mime)))
    throw new Unfit(`This browser cannot play this kind of video${/hvc1|hev1/.test(video.mime) ? ' (HEVC, which newer phones record in to save room)' : ''}. Export or convert it to an ordinary MP4 (H.264) and try that. On an iPhone, Settings, Camera, Formats, "Most Compatible" records that way from then on.`);
  if (stopped()) throw new Stopped();
  const { stream, send: how, max_piece_bytes: most = 12 * 1024 * 1024 } = await begin(video.mime);
  const send = how === 'links' ? byLinks(stream.id, 'video/mp4') : toServer(stream.id);
  /** Tries until it works. `went` is asked, after a failure, whether it had in fact gone through and only the answer was lost. */
  const surely = async (what: () => Promise<unknown>, went?: () => Promise<boolean>) => {
    for (let tries = 0; ; tries++) {
      if (stopped()) throw new Stopped();
      try {
        await what();
        return;
      } catch (e) {
        if (e instanceof Refused) throw e;
        if (went && (await went().catch(() => false))) return;
        if (tries >= 40) throw new Error('The connection was lost for too long, so the video was not brought in. Check it and try again.');
        await new Promise((r) => setTimeout(r, 1500));
      }
    }
  };
  await surely(() => send.init(new Blob([video.init as BlobPart], { type: 'video/mp4' })));
  for (let n = 0; n < video.pieces; n++) {
    if (stopped()) throw new Stopped();
    const bytes = await video.piece(n);
    if (bytes.length > most) throw new Unfit('This video is too sharp to bring in: a few seconds of it is more than the site takes at once. Export it at 1080p or lower and try that.');
    const blob = new Blob([bytes as BlobPart], { type: 'video/mp4' });
    await surely(
      () => send.piece(n, blob),
      async () => (await api.stream(stream.id)).segments > n,
    );
    onChange({ sent: n + 1, of: video.pieces });
  }
  return stream;
}

// ---------- Broadcasting ----------

/**
 * Broadcasts a camera a few seconds at a time, each piece a small video file of its own. The
 * camera is asked for afresh for every piece, so it can be turned around between them, and a
 * change of quality takes hold with the next piece.
 */
export function pieceBroadcaster(camera: () => MediaStream | null, stream: GameStream, how: SendHow, type: string, onSignal: (s: Signal) => void, keep = false, quality: Quality = 'low'): Broadcaster {
  const st = { on: false, timer: 0, recorder: null as MediaRecorder | null, quality };
  // Separate pieces do not add up to one file, so a copy for this device is recorded beside them, without stopping.
  const copy = { recorder: null as MediaRecorder | null, parts: [] as Blob[] };
  const out = outbox(stream, how, type, onSignal, () => (st.on = false));
  /** Records one piece, and starts the next as this one ends, for as long as the broadcast is on. */
  const record = () => {
    const m = camera();
    if (!st.on || !m) return;
    const rec = new MediaRecorder(m, { mimeType: type, ...bits(st.quality) });
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
        copy.recorder = new MediaRecorder(m, { mimeType: type, ...bits(st.quality) });
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
    quality: async (q) => {
      st.quality = q;
      await resize(camera(), q);
    },
    recording: () => (copy.parts.length ? [new Blob(copy.parts, { type: type.split(';')[0] })] : []),
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
export function openBroadcast(camera: () => MediaStream | null, type: string, quality: Quality = 'low'): Promise<Opening> {
  const separate: Opening = { layout: 'separate', begin: (stream, how, onSignal, keep) => pieceBroadcaster(camera, stream, how, type, onSignal, keep, quality), cancel: () => {} };
  const mp4 = type.split(';')[0];
  const st = {
    quality,
    rec: null as MediaRecorder | null,
    // Lumps are read one after another, in the order they came.
    reading: Promise.resolve() as Promise<void>,
    // The first opening part, which comes before the broadcast has begun and waits for it.
    first: null as Blob | null,
    parts: [] as Uint8Array[],
    cutAt: Date.now(),
    out: null as ReturnType<typeof outbox> | null,
    seconds: 4,
  };
  // The copy for this device, when one is wanted: an opening part and the fragments after it, which together are one video file,
  // and another such run for each change of quality. It has everything, even pieces that were dropped on the way out because the connection was slow.
  let kept: Blob[][] | null = null;
  let known: (fit: boolean) => void = () => {};
  /** Hands on what has been gathered as one piece. */
  const flush = () => {
    if (!st.out || st.parts.length === 0) return;
    st.out.push(new Blob(st.parts as BlobPart[], { type: mp4 }));
    st.parts = [];
    st.cutAt = Date.now();
  };
  /**
   * Starts a recorder at the quality now chosen. What it puts out begins with an opening part of
   * its own, which goes out ahead of its pieces: a change of quality is a new recorder, and the
   * video carries on from its opening part.
   */
  const record = () => {
    const m = camera();
    if (!m) return false;
    let rec: MediaRecorder;
    try {
      // A fresh start for the picture every two seconds, where the browser will: a piece can only begin at one.
      rec = new MediaRecorder(m, { mimeType: type, ...bits(st.quality), videoKeyFrameIntervalDuration: 2000 } as MediaRecorderOptions);
    } catch {
      return false;
    }
    const cut = cutter();
    rec.ondataavailable = (e) => {
      st.reading = st.reading.then(async () => {
        for (const c of cut(new Uint8Array(await e.data.arrayBuffer()))) {
          if (c.kind === 'unfit') known(false);
          else if (c.kind === 'init') {
            const part = new Blob([c.bytes as BlobPart], { type: mp4 });
            if (st.out) {
              kept?.push([part]);
              st.out.init(part);
            } else st.first = part;
            known(true);
          } else {
            kept?.at(-1)?.push(new Blob([c.bytes as BlobPart]));
            st.parts.push(c.bytes);
            // A piece is whole fragments, cut once enough time has gone by.
            if (Date.now() - st.cutAt >= st.seconds * 1000 - 500) flush();
          }
        }
      });
    };
    rec.start(1000);
    st.rec = rec;
    return true;
  };
  /** Stops the recorder and waits for the last of what it had to be read. */
  const halt = async () => {
    const rec = st.rec;
    if (rec && rec.state !== 'inactive') await new Promise<void>((done) => ((rec.onstop = () => done()), rec.stop()));
    await new Promise((r) => setTimeout(r, 100));
    await st.reading;
  };
  if (!type.startsWith('video/mp4') || !record()) return Promise.resolve(separate);
  return new Promise<Opening>((resolve) => {
    const timer = window.setTimeout(() => known(false), PROBE_MS);
    known = (fit) => {
      known = () => {};
      window.clearTimeout(timer);
      if (!fit) {
        halt();
        return resolve(separate);
      }
      // Changes of quality happen one at a time, and stopping waits for one that is under way.
      let changing: Promise<void> = Promise.resolve();
      resolve({
        layout: 'joined',
        cancel: () => void halt(),
        begin: (stream, how, onSignal, keep) => {
          if (keep) kept = [[st.first!, ...st.parts.map((p) => new Blob([p as BlobPart]))]];
          st.seconds = stream.segment_seconds;
          st.cutAt = Date.now();
          st.out = outbox(stream, how, type, onSignal, () => void halt());
          st.out.init(st.first!);
          return {
            // It has been recording since it was opened.
            start: () => {},
            stop: async (wait = true) => {
              await changing;
              await halt();
              // What the recorder had left goes as the last piece.
              if (wait) flush();
              await st.out!.drain(wait);
            },
            quality: (q) =>
              (changing = changing.then(async () => {
                if (q === st.quality) return;
                st.quality = q;
                // The recorder is stopped, what it had goes out as a piece, the camera is resized, and a new recorder carries on.
                await halt();
                flush();
                await resize(camera(), q);
                // The camera takes a moment to hand over pictures at its new size, and a recorder keeps the size of the first one it sees.
                await new Promise((r) => setTimeout(r, 500));
                record();
              })),
            recording: () => (kept ?? []).filter((run) => run.length > 1).map((run) => new Blob(run, { type: mp4 })),
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
  /** Opening part `k` of a joined video. */
  init: (k: number) => Promise<Blob | null>;
  /** Which opening part piece `n` carries on from. */
  initFor: (n: number) => number;
  /** A piece as a video file that plays on its own: for a joined video, its opening part and then the piece. */
  whole: (n: number) => Promise<Blob | null>;
  /** Told the stream again as it grows, since a live one can gain opening parts. */
  know: (stream: GameStream) => void;
}
export function pieceFetcher(stream: GameStream): Pieces {
  let type = stream.mime.split(';')[0];
  let inits = stream.inits ?? [];
  let piece: Pieces['piece'];
  let init: Pieces['init'];
  if (stream.watch !== 'links') {
    const from = (what: number | string) => fetch(`/api/streams/${stream.id}/segments/${what}`).then((r) => (r.ok ? r.blob() : null));
    piece = from;
    init = (k) => from(k === 0 ? 'init' : `init${k}`);
  } else {
    // Links are asked for a few at a time, and again once they are near running out. Pieces are known by number, opening parts as "i0", "i1".
    const links = new Map<number | string, { url: string; until: number }>();
    const get = async (what: number | string, from: number) => {
      let link = links.get(what);
      if (!link || link.until < Date.now()) {
        const r = await api.watchLinks(stream.id, from);
        type = r.type || type;
        const until = Date.now() + (r.good_for - 30) * 1000;
        for (const l of r.links) links.set(l.n, { url: l.url, until });
        for (const i of r.inits ?? []) links.set(`i${i.k}`, { url: i.url, until });
        link = links.get(what);
        if (!link) return null;
      }
      const res = await fetch(link.url);
      if (!res.ok) {
        links.delete(what);
        return null;
      }
      // The kind of video is the stream's, whatever the store says it is.
      return new Blob([await res.arrayBuffer()], { type });
    };
    piece = (n) => get(n, n);
    init = (k) => get(`i${k}`, 0);
  }
  const know = (s: GameStream) => void (inits = s.inits ?? inits);
  if (stream.layout !== 'joined') return { piece, init: async () => null, initFor: () => 0, whole: piece, know };
  // An opening part never changes, so each is fetched once.
  const had = new Map<number, Promise<Blob | null>>();
  const once = (k: number) => {
    if (!had.has(k)) had.set(k, init(k).then((b) => b ?? (had.delete(k), null), () => (had.delete(k), null)));
    return had.get(k)!;
  };
  const initFor = (n: number) => inits.reduce((at, from, k) => (from <= n ? k : at), 0);
  return {
    piece,
    init: once,
    initFor,
    whole: async (n) => {
      const [a, b] = await Promise.all([once(initFor(n)), piece(n)]);
      return a && b ? new Blob([a, b], { type }) : null;
    },
    know,
  };
}

/**
 * A moment in a video: a piece of it, and how far into that piece in seconds. The pieces are a
 * few seconds each but not all the same length, so "a minute in" would not find the same moment
 * twice, and this does.
 */
export interface Mark {
  n: number;
  off: number;
}
/** What a joined video's player has to say as it plays. */
export interface Playing {
  /** The piece now showing. */
  piece?: number;
  /** Exactly where it is. */
  at?: Mark;
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
  /** Moves to a moment that is already loaded, and says whether it could: if not, the video is started again from there. */
  seek: (to: Mark) => boolean;
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
 * missing piece closes up, and where the broadcaster changed the quality the new opening part is
 * fed in first and the picture carries on at its new size. Gives null when this browser has no
 * such player (older iPhones), and the page plays piece by piece. With `follow`, a viewer who
 * falls far behind a live stream is brought back near the front; without it they are left where
 * they chose to be, having gone back. `offset` starts that many seconds into the first piece, and
 * `end` stops at a mark, which is how a clip is played.
 */
export function joinedPlayer(el: HTMLVideoElement, stream: GameStream, from: number, follow: boolean, onChange: (p: Playing) => void, opts: { offset?: number; end?: Mark } = {}): JoinedPlayer | null {
  const w = window as unknown as { ManagedMediaSource?: typeof MediaSource; MediaSource?: typeof MediaSource };
  const Source = w.ManagedMediaSource ?? w.MediaSource;
  const mime = sourceType(stream.mime);
  if (!Source || !Source.isTypeSupported(mime)) return null;
  const get = pieceFetcher(stream);
  const seconds = stream.segment_seconds;
  // `opening` is the opening part the player was last given: the next piece may need another.
  const st = { next: from, segments: stream.segments, live: stream.status === 'live', busy: false, closed: false, sb: null as SourceBuffer | null, opening: -1, sought: !opts.offset, done: false };
  // Where each piece begins on the player's own clock, noted as it is fed in: what turns the clock into a mark.
  const starts = new Map<number, number>();
  /** No piece past the end of a clip is fetched. */
  const upto = () => (opts.end ? Math.min(st.segments, opts.end.n + 1) : st.segments);
  const where = (): Mark => {
    let n = from;
    for (const [piece, at] of starts) if (at <= el.currentTime + 0.001 && piece >= n) n = piece;
    return { n, off: Math.max(0, el.currentTime - (starts.get(n) ?? 0)) };
  };
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
      // Stopped at a small hole in the video with more just past it: stepped over.
      if (!el.paused && el.readyState < 3) {
        for (let i = 0; i < sb.buffered.length; i++) {
          const gap = sb.buffered.start(i) - el.currentTime;
          if (gap > 0 && gap < 1.5) el.currentTime = sb.buffered.start(i) + 0.01;
        }
      }
      // Fallen far behind a live stream: step over to near the front.
      if (follow && st.live && st.segments - st.next > 6) st.next = st.segments - 2;
      while (!st.closed && st.next < upto() && ahead(sb) < AHEAD_PIECES * seconds) {
        let opening: Blob | null = null;
        let part: Blob | null;
        const k = get.initFor(st.next);
        try {
          if (k !== st.opening) opening = await get.init(k);
          part = await get.piece(st.next);
        } catch {
          // The connection: tried again on the next turn.
          return;
        }
        if (st.closed) return;
        if (k !== st.opening) {
          // Without its opening part a piece cannot be played. Tried again on the next turn.
          if (!opening) return;
          // What follows is another recording, with times of its own. It is set down exactly where the last one ended, or a sliver of nothing is left between them and the video stops at it.
          sb.abort();
          sb.timestampOffset = sb.buffered.length ? sb.buffered.end(sb.buffered.length - 1) : 0;
          await give(sb, opening);
          st.opening = k;
        }
        if (part) {
          starts.set(st.next, sb.buffered.length ? sb.buffered.end(sb.buffered.length - 1) : 0);
          await give(sb, part);
          // Starting part-way into the first piece.
          if (!st.sought) {
            st.sought = true;
            el.currentTime = (starts.get(from) ?? 0) + (opts.offset ?? 0);
          }
        }
        st.next += 1;
      }
      // A video that is over is told so, and plays out what it has.
      if ((!st.live || opts.end) && st.next >= upto() && ms.readyState === 'open' && !sb.updating) ms.endOfStream();
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
        const k = get.initFor(from);
        const opening = await get.init(k);
        if (st.closed) return;
        if (!opening) return void fail();
        await give(sb, opening);
        st.opening = k;
        st.sb = sb;
        fill();
      } catch {
        fail();
      }
    },
    { once: true },
  );
  const timer = window.setInterval(fill, 500);
  const onTime = () => {
    const at = where();
    onChange({ piece: from + Math.floor(el.currentTime / seconds), at });
    // The end of a clip: stopped there, and said once.
    if (opts.end && !st.done && (at.n > opts.end.n || (at.n === opts.end.n && at.off >= opts.end.off))) {
      st.done = true;
      el.pause();
      onChange({ ended: true });
    }
  };
  const onWaiting = () => onChange({ waiting: st.live && st.next >= st.segments });
  const onPlaying = () => onChange({ waiting: false });
  const onEnded = () => {
    if (st.done) return;
    st.done = true;
    onChange({ ended: true });
  };
  el.addEventListener('timeupdate', onTime);
  el.addEventListener('waiting', onWaiting);
  el.addEventListener('playing', onPlaying);
  el.addEventListener('ended', onEnded);
  return {
    more: (s) => {
      st.segments = s.segments;
      st.live = s.status === 'live';
      get.know(s);
      fill();
    },
    seek: (to) => {
      const sb = st.sb;
      const begins = starts.get(to.n);
      if (!sb || begins === undefined || st.closed || st.done || el.ended) return false;
      const t = begins + to.off;
      try {
        for (let i = 0; i < sb.buffered.length; i++) {
          if (sb.buffered.start(i) <= t && t < sb.buffered.end(i) - 0.1) {
            el.currentTime = t;
            fill();
            return true;
          }
        }
      } catch {
        // The player has let go of its video: started again instead.
      }
      return false;
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
