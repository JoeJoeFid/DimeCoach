// How sharp a broadcast's picture is, and the rule that moves it down when the connection cannot
// keep up and back up when it plainly can. Nothing here touches the camera or the network, so it
// can be tried on its own (castQuality.test.mjs).

/**
 * How sharp the picture is. Sharper needs a better connection, and makes a bigger video. The
 * sizes are ones cameras take pictures at: a recording comes out at the camera's own size, so a
 * size in between (540p, say) would be recorded at the next one up whatever was asked for.
 */
export type Quality = 'lowest' | 'low' | 'medium' | 'high';
export const QUALITIES: Record<Quality, { label: string; says: string; width: number; height: number; video: number; audio: number }> = {
  lowest: { label: 'Lowest', says: '360p, lighter still. For a poor connection.', width: 640, height: 360, video: 350_000, audio: 32_000 },
  low: { label: 'Low', says: '360p. For a weak connection.', width: 640, height: 360, video: 700_000, audio: 48_000 },
  medium: { label: 'Medium', says: '720p. A good balance.', width: 1280, height: 720, video: 1_800_000, audio: 64_000 },
  high: { label: 'High', says: '1080p. Needs a strong connection.', width: 1920, height: 1080, video: 4_000_000, audio: 64_000 },
};
/** From the lightest to the sharpest. */
export const RUNGS: Quality[] = ['lowest', 'low', 'medium', 'high'];
/** What a quality sends each second, in bits. */
export const bitsOf = (q: Quality) => QUALITIES[q].video + QUALITIES[q].audio;

/** What the sender says after each piece: how many are waiting, how fast the last one went, and whether one stalled. */
export interface Heard {
  behind: number;
  /** Bits a second the last piece went out at. Only said when a piece has just gone. */
  rate?: number;
  /** A piece did not go in the time it was given. */
  stalled?: boolean;
}
/** What the rule remembers between one piece and the next. */
export interface Auto {
  at: Quality;
  /** When the quality last changed, and when it last went up. */
  changed: number;
  rose: number;
  /** How fast the pieces since the last change went. */
  rates: number[];
  /** Qualities that proved too much, and until when each is left alone. */
  barred: Partial<Record<Quality, number>>;
  /** How long the next one that proves too much is left alone. */
  hold: number;
}

/** After a change the pieces already waiting are the old size, so nothing is judged for a moment. */
const SETTLE_MS = 8_000;
/** How long the connection must have been keeping up before a sharper picture is tried. */
const STEADY_MS = 20_000;
/** How many pieces in a row must have gone fast enough, and how much faster than the sharper picture needs. */
const STEADY_PIECES = 4;
const HEADROOM = 2;
/** A step up that is undone within this long was a mistake, and is not tried again for a while. */
const REGRET_MS = 60_000;
const HOLD_MS = 2 * 60_000;
const HOLD_MOST_MS = 16 * 60_000;

export const autoStart = (at: Quality, now: number): Auto => ({ at, changed: now, rose: 0, rates: [], barred: {}, hold: HOLD_MS });

/**
 * The quality to carry on at, given what the sender just said. Down when pieces are piling up or
 * one stalled: one step, or straight to the lightest when far behind. Up one step when nothing
 * has been waiting for a while and the pieces have been going out at twice what the sharper
 * picture needs. A step up that has to be undone is left alone for longer each time.
 */
export function autoStep(a: Auto, said: Heard, now: number): Auto {
  const i = RUNGS.indexOf(a.at);
  const rates = said.rate !== undefined ? [...a.rates, said.rate].slice(-STEADY_PIECES) : a.rates;
  const settled = now - a.changed >= SETTLE_MS;
  const down = said.behind >= 6 ? 0 : said.behind >= 3 || said.stalled ? i - 1 : i;
  if (down < i && i > 0 && (settled || said.stalled)) {
    const next: Auto = { ...a, at: RUNGS[Math.max(0, down)], changed: now, rates: [] };
    // It had only just gone up: that was too much for this connection.
    if (a.rose && now - a.rose < REGRET_MS) {
      next.barred = { ...a.barred, [a.at]: now + a.hold };
      next.hold = Math.min(a.hold * 2, HOLD_MOST_MS);
    }
    return next;
  }
  const up = RUNGS[i + 1];
  if (up && said.behind <= 1 && !said.stalled && now - a.changed >= STEADY_MS && rates.length >= STEADY_PIECES && Math.min(...rates) >= HEADROOM * bitsOf(up) && (a.barred[up] ?? 0) <= now)
    return { ...a, at: up, changed: now, rose: now, rates: [] };
  // Anything waiting means the pieces are not going as they are made: the count of good ones starts again.
  return { ...a, rates: said.behind > 1 || said.stalled ? [] : rates };
}
