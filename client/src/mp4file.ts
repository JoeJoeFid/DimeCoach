// Turning a video file someone already has into the pieces a game video is made of.
//
// A video recorded here is one opening part and a row of pieces a few seconds long, each of
// which can be played after any other (mp4boxes.ts, server/streams.js). A file from a phone or a
// camera is laid out another way: all of its picture and sound in one lump, and an index (`moov`)
// saying where each frame is. What is here reads that index and writes the same frames out again
// as an opening part and pieces, each starting on a frame that stands on its own. Nothing is
// decoded or made again, so it is quick and the picture is exactly what it was.
//
// A file that is already laid out in pieces (one saved from a broadcast here) is only cut.
// It knows nothing of networks: it is given something to read from and hands back bytes.

/** Something to read a file from, a part at a time, so a long video is never held whole. */
export interface Source {
  size: number;
  read: (at: number, length: number) => Promise<Uint8Array>;
}
/** A file that cannot be made into a game video, with why, in words for the person who chose it. */
export class Unfit extends Error {}
/** A video ready to be sent: its opening part, and each piece when asked for. */
export interface Prepared {
  /** What kind of video it is, as a browser's player wants it said. */
  mime: string;
  init: Uint8Array;
  pieces: number;
  seconds: number;
  piece: (n: number) => Promise<Uint8Array>;
}

/** No one piece may be bigger than this to be put together: a file with too few frames that stand on their own. */
const MOST_PIECE_BYTES = 96 * 1024 * 1024;
const MOST_INDEX_BYTES = 256 * 1024 * 1024;
const MOST_OPENING_BYTES = 256 * 1024;
/** A piece may begin this much before its time, when that is where the frame to begin on is. */
const EARLY = 0.25;

// ---------- Reading ----------

const u16 = (b: Uint8Array, at: number) => (b[at] << 8) + b[at + 1];
const u32 = (b: Uint8Array, at: number) => b[at] * 0x1000000 + (b[at + 1] << 16) + (b[at + 2] << 8) + b[at + 3];
const i32 = (b: Uint8Array, at: number) => u32(b, at) | 0;
const u64 = (b: Uint8Array, at: number) => u32(b, at) * 0x100000000 + u32(b, at + 4);
const nameAt = (b: Uint8Array, at: number) => String.fromCharCode(b[at], b[at + 1], b[at + 2], b[at + 3]);

/** A box inside some bytes: where it starts, where what it holds starts, and where it ends. */
interface Box {
  name: string;
  at: number;
  body: number;
  end: number;
}
function* boxes(b: Uint8Array, from: number, to: number): Generator<Box> {
  for (let at = from; at + 8 <= to; ) {
    let size = u32(b, at);
    let body = at + 8;
    if (size === 1) {
      if (at + 16 > to) return;
      size = u64(b, at + 8);
      body = at + 16;
    } else if (size === 0) size = to - at;
    if (size < body - at || at + size > to) return;
    yield { name: nameAt(b, at + 4), at, body, end: at + size };
    at += size;
  }
}
const find = (b: Uint8Array, inside: { body: number; end: number }, name: string): Box | null => {
  for (const x of boxes(b, inside.body, inside.end)) if (x.name === name) return x;
  return null;
};
/** A box some way down: each name is looked for inside the one before. */
const dig = (b: Uint8Array, inside: { body: number; end: number }, ...names: string[]): Box | null => {
  let at: { body: number; end: number } | null = inside;
  for (const n of names) {
    at = find(b, at, n);
    if (!at) return null;
  }
  return at as Box;
};

// ---------- Writing ----------

type Part = Uint8Array | number[];
const be16 = (n: number) => [(n >>> 8) & 255, n & 255];
const be32 = (n: number) => [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255];
const be64 = (n: number) => [...be32(Math.floor(n / 0x100000000)), ...be32(n % 0x100000000)];
const chars = (s: string) => [...s].map((c) => c.charCodeAt(0));
const zeros = (n: number) => new Array<number>(n).fill(0);
const join = (parts: Part[]) => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
};
const box = (name: string, ...parts: Part[]) => {
  const body = join(parts);
  return join([be32(8 + body.length), chars(name), body]);
};
/** A box that begins with a version and some flags, as most do. */
const full = (name: string, version: number, flags: number, ...parts: Part[]) => box(name, [version, (flags >> 16) & 255, (flags >> 8) & 255, flags & 255], ...parts);

// ---------- What the picture and the sound are ----------

const hex = (n: number) => n.toString(16).toUpperCase().padStart(2, '0');
/**
 * The description of the picture, written afresh with only what a player needs, and the name a
 * browser knows that kind of picture by. Null for a kind that cannot be played here.
 */
function pictureOf(e: Uint8Array): { entry: Uint8Array; codec: string } | null {
  const kind = nameAt(e, 4);
  if (!['avc1', 'avc3', 'hvc1', 'hev1'].includes(kind) || e.length < 86) return null;
  const kids: Uint8Array[] = [];
  let codec = '';
  for (const x of boxes(e, 86, e.length)) {
    if (x.name === 'avcC' && x.end - x.body >= 4) codec = `${kind}.${hex(e[x.body + 1])}${hex(e[x.body + 2])}${hex(e[x.body + 3])}`;
    else if (x.name === 'hvcC' && x.end - x.body >= 13) {
      const c = e.subarray(x.body, x.end);
      // The profiles it keeps to are said backwards, bit for bit.
      let fits = 0;
      for (let i = 0; i < 32; i++) if (u32(c, 2) & (2 ** i)) fits += 2 ** (31 - i);
      const limits = [...c.subarray(6, 12)];
      while (limits.length && limits[limits.length - 1] === 0) limits.pop();
      codec = `${kind}.${['', 'A', 'B', 'C'][c[1] >> 6]}${c[1] & 31}.${fits.toString(16).toUpperCase()}.${c[1] & 32 ? 'H' : 'L'}${c[12]}${limits.map((l) => `.${l.toString(16).toUpperCase()}`).join('')}`;
    } else if (x.name !== 'pasp') continue;
    kids.push(e.subarray(x.at, x.end));
  }
  if (!codec) return null;
  const head = e.slice(8, 86);
  head.set([0, 0, 0, 0, 0, 0, 0, 1], 0);
  return { entry: box(kind, head, ...kids), codec };
}
/** The length of a part of a sound description, which is written a byte at a time. */
function lengthAt(b: Uint8Array, at: number): { n: number; next: number } {
  let n = 0;
  for (let i = 0; i < 4; i++) {
    const c = b[at++];
    n = (n << 7) | (c & 127);
    if (!(c & 128)) break;
  }
  return { n, next: at };
}
/** The kind of sound a description is of, as a browser names it. Empty when it is not one that plays here. */
function soundName(esds: Uint8Array): string {
  // Past the version: a description of the stream, and inside it one of how to decode it.
  let at = 12;
  if (esds[at++] !== 3) return '';
  at = lengthAt(esds, at).next;
  const flags = esds[at + 2];
  at += 3 + (flags & 128 ? 2 : 0);
  if (flags & 64) at += 1 + esds[at];
  if (flags & 32) at += 2;
  if (esds[at++] !== 4) return '';
  at = lengthAt(esds, at).next;
  if (esds[at] !== 0x40) return '';
  at += 13;
  if (esds[at++] !== 5) return 'mp4a.40.2';
  at = lengthAt(esds, at).next;
  const kind = esds[at] >> 3;
  return kind > 0 && kind < 31 ? `mp4a.40.${kind}` : 'mp4a.40.2';
}
/**
 * The description of the sound, written afresh the plain way. Files from a camera or an iPhone
 * say it in an older, longer form that players fed video a piece at a time do not read.
 */
function soundOf(e: Uint8Array): { entry: Uint8Array; codec: string } | null {
  if (nameAt(e, 4) !== 'mp4a' || e.length < 36) return null;
  const version = u16(e, 16);
  const kids = version === 1 ? 52 : version === 2 ? 72 : 36;
  let channels = u16(e, 24);
  let rate = u16(e, 32);
  if (version === 2 && e.length >= 72) {
    channels = u32(e, 48);
    rate = Math.round(new DataView(e.buffer, e.byteOffset + 40, 8).getFloat64(0));
  }
  let esds: Uint8Array | null = null;
  for (const x of boxes(e, kids, e.length)) {
    if (x.name === 'esds') esds = e.subarray(x.at, x.end);
    if (x.name === 'wave') for (const y of boxes(e, x.body, x.end)) if (y.name === 'esds') esds = e.subarray(y.at, y.end);
  }
  if (!esds) return null;
  const codec = soundName(esds);
  if (!codec) return null;
  return { entry: box('mp4a', zeros(6), be16(1), zeros(8), be16(channels || 2), be16(16), zeros(4), be16(rate & 0xffff), be16(0), esds), codec };
}

// ---------- The index ----------

/** One run of picture or of sound in a file, as its index describes it. */
interface Track {
  id: number;
  kind: string;
  /** How many of its ticks make a second. */
  ticks: number;
  tkhd: Uint8Array;
  entry: Uint8Array | null;
  stbl: Box | null;
  /** Where it is said to begin, in its own ticks: frames are shown that much earlier than their times say. */
  shift: number;
}
function tracksOf(m: Uint8Array): Track[] {
  const out: Track[] = [];
  for (const trak of boxes(m, 8, m.length)) {
    if (trak.name !== 'trak') continue;
    const tkhd = find(m, trak, 'tkhd');
    const mdhd = dig(m, trak, 'mdia', 'mdhd');
    const hdlr = dig(m, trak, 'mdia', 'hdlr');
    if (!tkhd || !mdhd || !hdlr) continue;
    const stbl = dig(m, trak, 'mdia', 'minf', 'stbl');
    const stsd = stbl && find(m, stbl, 'stsd');
    let entry: Uint8Array | null = null;
    if (stsd) for (const x of boxes(m, stsd.body + 8, stsd.end)) {
      entry = m.subarray(x.at, x.end);
      break;
    }
    let shift = 0;
    const elst = dig(m, trak, 'edts', 'elst');
    if (elst) {
      const long = m[elst.body] === 1;
      for (let i = 0, at = elst.body + 8; i < u32(m, elst.body + 4) && at + (long ? 20 : 12) <= elst.end; i++, at += long ? 20 : 12) {
        const from = long ? i32(m, at + 8) * 0x100000000 + u32(m, at + 12) : i32(m, at + 4);
        if (from >= 0) {
          shift = from;
          break;
        }
      }
    }
    out.push({ id: u32(m, tkhd.body + (m[tkhd.body] === 1 ? 20 : 12)), kind: nameAt(m, hdlr.body + 8), ticks: u32(m, mdhd.body + (m[mdhd.body] === 1 ? 20 : 12)) || 1, tkhd: m.slice(tkhd.at, tkhd.end), entry, stbl, shift });
  }
  return out;
}

/** Every frame of a track: how big it is, where it is in the file, when it is, and whether it stands on its own. */
interface Frames {
  count: number;
  size: Uint32Array;
  at: Float64Array;
  when: Float64Array;
  lasts: Uint32Array;
  /** How much later than `when` it is shown: a frame can be needed before the ones shown ahead of it. */
  late: Int32Array;
  whole: Uint8Array;
}
const broken = () => new Unfit('This video file is damaged or incomplete, so it cannot be read.');
function framesOf(m: Uint8Array, stbl: Box): Frames {
  const table = (name: string, row: number, head = 8) => {
    const t = find(m, stbl, name);
    if (!t) return null;
    const rows = u32(m, t.body + 4 + (head - 8));
    if (t.body + head + rows * row > t.end) throw broken();
    return { at: t.body + head, rows };
  };
  const stsz = find(m, stbl, 'stsz');
  if (!stsz) throw new Unfit('This video file is laid out in a way that cannot be read here.');
  const same = u32(m, stsz.body + 4);
  const count = u32(m, stsz.body + 8);
  if (count > 6_000_000 || (!same && stsz.body + 12 + count * 4 > stsz.end)) throw broken();
  const size = new Uint32Array(count);
  for (let i = 0; i < count; i++) size[i] = same || u32(m, stsz.body + 12 + i * 4);

  // Frames are kept in runs, and the index says where each run starts and how many frames are in it.
  const wide = !find(m, stbl, 'stco');
  const runs = table(wide ? 'co64' : 'stco', wide ? 8 : 4);
  const stsc = table('stsc', 12);
  if (!runs || !stsc) throw broken();
  const at = new Float64Array(count);
  let s = 0;
  for (let e = 0; e < stsc.rows && s < count; e++) {
    const p = stsc.at + e * 12;
    const upto = e + 1 < stsc.rows ? u32(m, p + 12) : runs.rows + 1;
    if (u32(m, p + 8) !== 1) throw new Unfit('This video changes its picture size or sound part-way through, which cannot be brought in. Export it again as one plain video and try that.');
    for (let c = u32(m, p); c < upto && c <= runs.rows && s < count; c++) {
      let where = wide ? u64(m, runs.at + (c - 1) * 8) : u32(m, runs.at + (c - 1) * 4);
      for (let k = 0; k < u32(m, p + 4) && s < count; k++) {
        at[s] = where;
        where += size[s++];
      }
    }
  }
  if (s < count) throw broken();

  const when = new Float64Array(count);
  const lasts = new Uint32Array(count);
  const stts = table('stts', 8);
  let t = 0;
  s = 0;
  for (let e = 0; stts && e < stts.rows && s < count; e++) {
    const each = u32(m, stts.at + e * 8 + 4);
    for (let k = u32(m, stts.at + e * 8); k > 0 && s < count; k--) {
      when[s] = t;
      lasts[s++] = each;
      t += each;
    }
  }
  if (s < count) throw broken();

  const late = new Int32Array(count);
  const ctts = table('ctts', 8);
  s = 0;
  for (let e = 0; ctts && e < ctts.rows && s < count; e++) {
    const by = i32(m, ctts.at + e * 8 + 4);
    for (let k = u32(m, ctts.at + e * 8); k > 0 && s < count; k--) late[s++] = by;
  }

  // With no list of them, every frame stands on its own, as every bit of sound does.
  const stss = table('stss', 4);
  const whole = new Uint8Array(count).fill(stss ? 0 : 1);
  for (let e = 0; stss && e < stss.rows; e++) {
    const n = u32(m, stss.at + e * 4);
    if (n >= 1 && n <= count) whole[n - 1] = 1;
  }
  return { count, size, at, when, lasts, late, whole };
}

// ---------- The opening part ----------

const UNIT = [...be32(0x10000), ...zeros(12), ...be32(0x10000), ...zeros(12), ...be32(0x40000000)];
/** A track's own header, with the length it claims taken out: the pieces say how long it is as they come. */
function header(t: Track) {
  const h = t.tkhd.slice();
  const long = h[8] === 1;
  h.fill(0, long ? 36 : 28, long ? 44 : 32);
  return h;
}
const trackBox = (t: Track, entry: Uint8Array) =>
  box(
    'trak',
    header(t),
    box(
      'mdia',
      full('mdhd', 0, 0, zeros(8), be32(t.ticks), zeros(4), be16(0x55c4), zeros(2)),
      full('hdlr', 0, 0, zeros(4), chars(t.kind), zeros(12), [0]),
      box(
        'minf',
        t.kind === 'vide' ? full('vmhd', 0, 1, zeros(8)) : full('smhd', 0, 0, zeros(4)),
        box('dinf', full('dref', 0, 0, be32(1), full('url ', 0, 1))),
        box('stbl', full('stsd', 0, 0, be32(1), entry), full('stts', 0, 0, zeros(4)), full('stsc', 0, 0, zeros(4)), full('stsz', 0, 0, zeros(8)), full('stco', 0, 0, zeros(4))),
      ),
    ),
  );
function opening(tracks: { t: Track; entry: Uint8Array }[]) {
  return join([
    box('ftyp', chars('isom'), be32(0x200), chars('isomiso5iso6mp41')),
    box(
      'moov',
      full('mvhd', 0, 0, zeros(8), be32(1000), zeros(4), be32(0x10000), be16(0x100), zeros(10), UNIT, zeros(24), be32(Math.max(...tracks.map((x) => x.t.id)) + 1)),
      ...tracks.map((x) => trackBox(x.t, x.entry)),
      box('mvex', ...tracks.map((x) => full('trex', 0, 0, be32(x.t.id), be32(1), zeros(12)))),
    ),
  ]);
}

// ---------- Pieces ----------

/** The part of a piece that says what one track's frames in it are: when, how long, how big. */
function run(t: Track, f: Frames, from: number, to: number, dataAt: number, picture: boolean) {
  const each = picture ? 16 : 8;
  const trun = new Uint8Array(20 + (to - from) * each);
  const v = new DataView(trun.buffer);
  v.setUint32(0, trun.length);
  trun.set(chars('trun'), 4);
  // Told for every frame: how long and how big, and for the picture whether it stands on its own and how late it is shown.
  v.setUint32(8, picture ? 0x01000f01 : 0x00000301);
  v.setUint32(12, to - from);
  v.setUint32(16, dataAt);
  for (let i = from, at = 20; i < to; i++, at += each) {
    v.setUint32(at, f.lasts[i]);
    v.setUint32(at + 4, f.size[i]);
    if (picture) {
      v.setUint32(at + 8, f.whole[i] ? 0x02000000 : 0x01010000);
      v.setInt32(at + 12, f.late[i] - t.shift);
    }
  }
  return box('traf', full('tfhd', 0, 0x020000, be32(t.id)), full('tfdt', 1, 0, be64(f.when[from])), trun);
}
/** Reads frames `from` to `to` of a track out of the file, into `into` at `at`. */
async function gather(src: Source, f: Frames, from: number, to: number, into: Uint8Array, at: number) {
  if (to <= from) return;
  let lo = Infinity;
  let hi = 0;
  for (let i = from; i < to; i++) {
    lo = Math.min(lo, f.at[i]);
    hi = Math.max(hi, f.at[i] + f.size[i]);
  }
  if (hi > src.size) throw new Unfit('This video file is cut short: part of it is missing. Copy it again from where it came from and try once more.');
  // Frames lie near one another, so they come in one read. In a file where they do not, each is read by itself.
  const all = hi - lo <= MOST_PIECE_BYTES ? await src.read(lo, hi - lo) : null;
  for (let i = from; i < to; i++) {
    into.set(all ? all.subarray(f.at[i] - lo, f.at[i] - lo + f.size[i]) : await src.read(f.at[i], f.size[i]), at);
    at += f.size[i];
  }
}

/** Where to begin each piece: at the first of `starts` that is at, or just before, each next `seconds`. */
function cutAt(starts: number[], seconds: number): number[] {
  const cuts = [0];
  for (let i = 1; i < starts.length; i++) if (starts[i] - starts[0] >= cuts.length * seconds - EARLY) cuts.push(i);
  return cuts;
}

async function fromIndex(src: Source, m: Uint8Array, seconds: number): Promise<Prepared> {
  const tracks = tracksOf(m);
  type Run = { t: Track; entry: Uint8Array; codec: string; f: Frames };
  const found: { pic?: Run; snd?: Run } = {};
  for (const t of tracks) {
    if (!t.entry || !t.stbl) continue;
    const made: { entry: Uint8Array; codec: string } | null = t.kind === 'vide' && !found.pic ? pictureOf(t.entry) : t.kind === 'soun' && !found.snd ? soundOf(t.entry) : null;
    if (!made) continue;
    const f = framesOf(m, t.stbl);
    if (f.count === 0) continue;
    if (t.kind === 'vide') found.pic = { t, ...made, f };
    else found.snd = { t, ...made, f };
  }
  if (!found.pic) {
    const kind = tracks.find((t) => t.kind === 'vide' && t.entry);
    throw new Unfit(kind ? `This video is a kind (${nameAt(kind.entry!, 4).trim()}) that cannot be brought in. Export or convert it to an ordinary MP4 (H.264) and try that.` : 'There is no picture in this file, so it is not a video that can be brought in.');
  }
  const p = found.pic;
  const s = found.snd;
  const shown = (i: number) => (p.f.when[i] + p.f.late[i] - p.t.shift) / p.t.ticks;
  // A piece begins on a frame that stands on its own.
  const whole: number[] = [];
  for (let i = 0; i < p.f.count; i++) if (i === 0 || p.f.whole[i]) whole.push(i);
  const cuts = cutAt(whole.map(shown), seconds).map((k) => whole[k]);
  // The sound that goes with each piece is what is heard from when its picture begins.
  const sounds: number[] = [0];
  if (s) {
    let a = 0;
    for (let k = 1; k < cuts.length; k++) {
      while (a < s.f.count && s.f.when[a] / s.t.ticks < shown(cuts[k])) a++;
      sounds.push(a);
    }
  }
  const last = p.f.count - 1;
  return {
    mime: `video/mp4;codecs="${[p.codec, s?.codec].filter(Boolean).join(',')}"`,
    init: opening(s ? [p, s] : [p]),
    pieces: cuts.length,
    seconds: (p.f.when[last] + p.f.lasts[last] - p.f.when[0]) / p.t.ticks,
    piece: async (n) => {
      const [v0, v1] = [cuts[n], cuts[n + 1] ?? p.f.count];
      const [a0, a1] = s ? [sounds[n], sounds[n + 1] ?? s.f.count] : [0, 0];
      let vBytes = 0;
      let aBytes = 0;
      for (let i = v0; i < v1; i++) vBytes += p.f.size[i];
      for (let i = a0; s && i < a1; i++) aBytes += s.f.size[i];
      if (vBytes + aBytes > MOST_PIECE_BYTES) throw new Unfit('This video cannot be cut into short pieces: too little of it can be started from. Export or convert it to an ordinary MP4 and try that.');
      // The list of frames comes first, and says how far past its own start the frames themselves are.
      const head = 8 + 16 + (44 + 20 + (v1 - v0) * 16) + (s && a1 > a0 ? 44 + 20 + (a1 - a0) * 8 : 0);
      const moof = box('moof', full('mfhd', 0, 0, be32(n + 1)), run(p.t, p.f, v0, v1, head + 8, true), ...(s && a1 > a0 ? [run(s.t, s.f, a0, a1, head + 8 + vBytes, false)] : []));
      const out = new Uint8Array(moof.length + 8 + vBytes + aBytes);
      out.set(moof, 0);
      out.set([...be32(8 + vBytes + aBytes), ...chars('mdat')], moof.length);
      await gather(src, p.f, v0, v1, out, moof.length + 8);
      if (s) await gather(src, s.f, a0, a1, out, moof.length + 8 + vBytes);
      return out;
    },
  };
}

/** A file already laid out in pieces: its own opening part, and its own pieces gathered a few seconds at a time. */
async function fromPieces(src: Source, top: Top[], m: Uint8Array, seconds: number): Promise<Prepared> {
  const tracks = tracksOf(m);
  const picture = tracks.find((t) => t.kind === 'vide' && t.entry && pictureOf(t.entry));
  if (!picture) throw new Unfit('This video is a kind that cannot be brought in. Export or convert it to an ordinary MP4 (H.264) and try that.');
  const sound = tracks.find((t) => t.kind === 'soun' && t.entry && soundOf(t.entry));
  const ftyp = top.find((b) => b.name === 'ftyp');
  const init = join([ftyp ? await src.read(ftyp.at, ftyp.size) : box('ftyp', chars('isom'), be32(0x200), chars('isomiso5iso6mp41')), m]);
  if (init.length > MOST_OPENING_BYTES) throw new Unfit('This video file is laid out in a way that cannot be read here. Export or convert it to an ordinary MP4 and try that.');
  // Each run of picture says when it begins. A new piece can begin wherever one does.
  const starts: { at: number; when: number }[] = [];
  let end = 0;
  for (const b of top) {
    if (b.name === 'mdat' && starts.length) end = b.at + b.size;
    if (b.name !== 'moof') continue;
    const moof = await src.read(b.at, b.size);
    for (const traf of boxes(moof, 8, moof.length)) {
      const tfhd = traf.name === 'traf' && find(moof, traf, 'tfhd');
      const tfdt = tfhd && u32(moof, tfhd.body + 4) === picture.id && find(moof, traf, 'tfdt');
      if (tfdt) starts.push({ at: b.at, when: (moof[tfdt.body] === 1 ? u64(moof, tfdt.body + 4) : u32(moof, tfdt.body + 4)) / picture.ticks });
    }
  }
  if (starts.length === 0 || end === 0) throw new Unfit('This video file is laid out in a way that cannot be read here. Export or convert it to an ordinary MP4 and try that.');
  const cuts = cutAt(starts.map((x) => x.when), seconds).map((k) => starts[k].at);
  const long = starts.length > 1 ? (starts[starts.length - 1].when - starts[0].when) * (starts.length / (starts.length - 1)) : seconds;
  return {
    mime: `video/mp4;codecs="${[pictureOf(picture.entry!)!.codec, sound && soundOf(sound.entry!)!.codec].filter(Boolean).join(',')}"`,
    init,
    pieces: cuts.length,
    seconds: long,
    piece: async (n) => {
      const to = cuts[n + 1] ?? end;
      if (to - cuts[n] > MOST_PIECE_BYTES) throw new Unfit('This video cannot be cut into short pieces. Export or convert it to an ordinary MP4 and try that.');
      return src.read(cuts[n], to - cuts[n]);
    },
  };
}

interface Top {
  name: string;
  at: number;
  size: number;
}
/**
 * Reads a video file's index and makes it ready to be sent as a game video, in pieces about
 * `seconds` long. Throws `Unfit`, saying why, for a file that cannot be.
 */
export async function prepareVideo(src: Source, seconds: number): Promise<Prepared> {
  const top: Top[] = [];
  for (let at = 0; at + 8 <= src.size; ) {
    const h = await src.read(at, Math.min(16, src.size - at));
    let size = u32(h, 0);
    if (size === 1 && h.length >= 16) size = u64(h, 8);
    else if (size === 0) size = src.size - at;
    if (size < 8 || !/^[\x20-\x7e]{4}$/.test(nameAt(h, 4))) break;
    top.push({ name: nameAt(h, 4), at, size: Math.min(size, src.size - at) });
    at += size;
  }
  const moov = top.find((b) => b.name === 'moov');
  if (!moov) {
    throw new Unfit(
      top.some((b) => b.name === 'ftyp' || b.name === 'mdat')
        ? 'This video file is incomplete: the part that says what is in it is missing. That happens when a recording was cut off before it finished saving.'
        : 'This is not a video file that can be brought in. It has to be an MP4 or MOV video, which is what phones and most cameras make.',
    );
  }
  if (moov.size > MOST_INDEX_BYTES || moov.at + moov.size > src.size) throw broken();
  const m = await src.read(moov.at, moov.size);
  return find(m, { body: 8, end: m.length }, 'mvex') && top.some((b) => b.name === 'moof') ? fromPieces(src, top, m, seconds) : fromIndex(src, m, seconds);
}

/** A file chosen in the browser, as something to read from. */
export const fileSource = (file: Blob): Source => ({ size: file.size, read: async (at, length) => new Uint8Array(await file.slice(at, at + length).arrayBuffer()) });
