// Keeping score in the sports that are not basketball: baseball and softball, football, volleyball.
//
// Basketball has a pad of its own, built around its shots (scoring.ts, ScorePad.tsx). The others
// share one pad (SportPad.tsx), and what is here is everything that differs between them: the
// plays a scorer can tap, what each is worth, how the game is divided up, and the numbers worth
// reading afterwards. A play is kept the same way basketball's are, as an event with a side, a
// player and a type, so a game of any sport is saved, sent and listed alike. The types carry the
// sport in front ("bb:hr", "fb:td", "vb:kill") so they can never be taken for one another.
//
// Nothing here draws anything or reaches the network, so it is tested on its own
// (sportScoring.test.mjs). The server needs to know only what each play is worth, and keeps its
// own copy of that (server/sportPoints.js); the test holds the two together.

export type ScoredSport = 'baseball' | 'football' | 'volleyball';

/** A play as it is kept: the part of a game event this file reads. */
export interface SportEvent {
  id: string;
  side: 'us' | 'them';
  player: number | null;
  type: string;
  period: number;
  /** An amount that goes with the play: yards, in football. */
  v?: number;
}

/** One thing a scorer can tap. */
export interface SportPlay {
  type: string;
  /** On its button. */
  label: string;
  /** In the list of plays, and to someone following along: "Home run". */
  title: string;
  /** What it adds to the score. */
  pts?: number;
  /** The points go to the other side: a volleyball error, which is this team's stat and their point. */
  other?: boolean;
  /** It is asked how many, in these: "yards". */
  amount?: string;
  /** It is the team's, and nobody is asked who. */
  team?: boolean;
  /** A second player has a part in it, asked for next and able to be skipped: who threw the touchdown, who set the kill. */
  also?: { type: string; ask: string };
  /** How its button is drawn: a score, something that went wrong, or neither. */
  tone?: 'good' | 'bad';
  /** What the button does, where that is not plain from its name. */
  hint?: string;
}

/** How many of each play, and the amounts that came with them added up. */
export interface Tally {
  n: Record<string, number>;
  v: Record<string, number>;
}
export const emptyTally = (): Tally => ({ n: {}, v: {} });
const n = (t: Tally, ...types: string[]) => types.reduce((sum, k) => sum + (t.n[k] || 0), 0);
const v = (t: Tally, ...types: string[]) => types.reduce((sum, k) => sum + (t.v[k] || 0), 0);
const over = (a: number, b: number) => (b > 0 ? a / b : null);

/** A number worth reading about a player or a team. */
export interface SportStat {
  key: string;
  /** The column heading. */
  label: string;
  /** In full, for a tooltip and for "what wins". */
  name: string;
  value: (t: Tally) => number | null;
  /** Worked out from other numbers, so it is never added up or averaged over games: it is worked out again from the totals. */
  ratio?: boolean;
  /** How it is written: a whole number unless said. `avg` is ".333", `pct` is "45%", `dec` is "4.2". */
  show?: 'avg' | 'pct' | 'dec';
}
/** A team's number in one game, to set against whether the game was won. */
export interface SportWinStat {
  key: string;
  name: string;
  rate?: boolean;
  value: (g: { us: Tally; them: Tally }) => number | null;
}

export interface SportDef {
  kind: ScoredSport;
  /** What a part of the game is called: "Inning". */
  period: string;
  /** A part of the game, short, for a table heading and beside a play: "Inn 3", "Q2", "Set 1". */
  periodName: (p: number) => string;
  /** The game is won by parts won, not points added up: volleyball's sets. */
  sets?: boolean;
  plays: SportPlay[];
  /** The team's own buttons, in the groups they are laid out in. */
  groups: { title: string; note?: string; plays: string[] }[];
  /** The other team's buttons. */
  them: string[];
  /** The columns of a table of players. */
  columns: SportStat[];
  /** The few numbers that sum a player up in a line. */
  line: string[];
  /** What is set against winning and losing. Whatever the score is made of is left out. */
  wins: SportWinStat[];
}

// ---------- Baseball and softball ----------

const hits = (t: Tally) => n(t, 'bb:1b', 'bb:2b', 'bb:3b', 'bb:hr');
const atBats = (t: Tally) => hits(t) + n(t, 'bb:k', 'bb:out', 'bb:roe');
const bases = (t: Tally) => n(t, 'bb:1b') + 2 * n(t, 'bb:2b') + 3 * n(t, 'bb:3b') + 4 * n(t, 'bb:hr');
const onBase = (t: Tally) => over(hits(t) + n(t, 'bb:bb', 'bb:hbp'), atBats(t) + n(t, 'bb:bb', 'bb:hbp', 'bb:sac'));
const BASEBALL: SportDef = {
  kind: 'baseball',
  period: 'Inning',
  periodName: (p) => `Inn ${p}`,
  plays: [
    { type: 'bb:1b', label: '1B', title: 'Single', tone: 'good' },
    { type: 'bb:2b', label: '2B', title: 'Double', tone: 'good' },
    { type: 'bb:3b', label: '3B', title: 'Triple', tone: 'good' },
    { type: 'bb:hr', label: 'HR', title: 'Home run', pts: 1, tone: 'good', hint: 'Counts the batter\'s own run and one run batted in. Add a Run and an RBI for anyone else who scored.' },
    { type: 'bb:bb', label: 'Walk', title: 'Walk' },
    { type: 'bb:hbp', label: 'HBP', title: 'Hit by pitch' },
    { type: 'bb:roe', label: 'On error', title: 'Reached on an error' },
    { type: 'bb:sac', label: 'Sac', title: 'Sacrifice' },
    { type: 'bb:k', label: 'K', title: 'Strikeout', tone: 'bad' },
    { type: 'bb:out', label: 'Out', title: 'Out', tone: 'bad', hint: 'Put out on a ball in play: a ground out, a fly out, a line out.' },
    { type: 'bb:run', label: 'Run', title: 'Run scored', pts: 1, tone: 'good' },
    { type: 'bb:rbi', label: 'RBI', title: 'Run batted in' },
    { type: 'bb:sb', label: 'Steal', title: 'Stolen base' },
    { type: 'bb:cs', label: 'Caught', title: 'Caught stealing', tone: 'bad' },
    { type: 'bb:pk', label: 'K thrown', title: 'Strikeout thrown' },
    { type: 'bb:pbb', label: 'Walk given', title: 'Walk given up', tone: 'bad' },
    { type: 'bb:ph', label: 'Hit given', title: 'Hit given up', tone: 'bad' },
    { type: 'bb:e', label: 'Error', title: 'Error', tone: 'bad' },
  ],
  groups: [
    { title: 'At bat', note: 'Who was batting, and how it ended.', plays: ['bb:1b', 'bb:2b', 'bb:3b', 'bb:hr', 'bb:bb', 'bb:hbp', 'bb:roe', 'bb:sac', 'bb:k', 'bb:out'] },
    { title: 'On the bases', plays: ['bb:run', 'bb:rbi', 'bb:sb', 'bb:cs'] },
    { title: 'In the field', note: 'The pitcher for the first three, the fielder for an error.', plays: ['bb:pk', 'bb:pbb', 'bb:ph', 'bb:e'] },
  ],
  them: ['bb:run'],
  columns: [
    { key: 'ab', label: 'AB', name: 'At bats', value: atBats },
    { key: 'r', label: 'R', name: 'Runs', value: (t) => n(t, 'bb:run', 'bb:hr') },
    { key: 'h', label: 'H', name: 'Hits', value: hits },
    { key: '2b', label: '2B', name: 'Doubles', value: (t) => n(t, 'bb:2b') },
    { key: '3b', label: '3B', name: 'Triples', value: (t) => n(t, 'bb:3b') },
    { key: 'hr', label: 'HR', name: 'Home runs', value: (t) => n(t, 'bb:hr') },
    { key: 'rbi', label: 'RBI', name: 'Runs batted in', value: (t) => n(t, 'bb:rbi', 'bb:hr') },
    { key: 'bb', label: 'BB', name: 'Walks', value: (t) => n(t, 'bb:bb') },
    { key: 'k', label: 'K', name: 'Strikeouts', value: (t) => n(t, 'bb:k') },
    { key: 'sb', label: 'SB', name: 'Stolen bases', value: (t) => n(t, 'bb:sb') },
    { key: 'avg', label: 'AVG', name: 'Batting average', ratio: true, show: 'avg', value: (t) => over(hits(t), atBats(t)) },
    { key: 'obp', label: 'OBP', name: 'On-base percentage', ratio: true, show: 'avg', value: onBase },
    { key: 'slg', label: 'SLG', name: 'Slugging', ratio: true, show: 'avg', value: (t) => over(bases(t), atBats(t)) },
    { key: 'pk', label: 'P-K', name: 'Strikeouts thrown', value: (t) => n(t, 'bb:pk') },
    { key: 'pbb', label: 'P-BB', name: 'Walks given up', value: (t) => n(t, 'bb:pbb') },
    { key: 'ph', label: 'P-H', name: 'Hits given up', value: (t) => n(t, 'bb:ph') },
    { key: 'e', label: 'E', name: 'Errors', value: (t) => n(t, 'bb:e') },
  ],
  line: ['h', 'ab', 'r', 'rbi', 'bb', 'k'],
  wins: [
    { key: 'h', name: 'Hits', value: (g) => hits(g.us) },
    { key: 'obp', name: 'On-base %', rate: true, value: (g) => { const o = onBase(g.us); return o === null ? null : o * 100; } },
    { key: 'xbh', name: 'Extra-base hits', value: (g) => n(g.us, 'bb:2b', 'bb:3b', 'bb:hr') },
    { key: 'bb', name: 'Walks drawn', value: (g) => n(g.us, 'bb:bb', 'bb:hbp') },
    { key: 'k', name: 'Strikeouts at the plate', value: (g) => n(g.us, 'bb:k') },
    { key: 'sb', name: 'Stolen bases', value: (g) => n(g.us, 'bb:sb') },
    { key: 'e', name: 'Errors', value: (g) => n(g.us, 'bb:e') },
    { key: 'pk', name: 'Strikeouts thrown', value: (g) => n(g.us, 'bb:pk') },
    { key: 'pbb', name: 'Walks given up', value: (g) => n(g.us, 'bb:pbb') },
    { key: 'ph', name: 'Hits given up', value: (g) => n(g.us, 'bb:ph') },
  ],
};

// ---------- Football ----------

const passes = (t: Tally) => n(t, 'fb:comp', 'fb:inc', 'fb:int');
const yards = (t: Tally) => v(t, 'fb:rush', 'fb:comp');
const FOOTBALL: SportDef = {
  kind: 'football',
  period: 'Quarter',
  periodName: (p) => (p <= 4 ? `Q${p}` : p === 5 ? 'OT' : `OT${p - 4}`),
  plays: [
    { type: 'fb:td', label: 'Touchdown', title: 'Touchdown', pts: 6, tone: 'good', also: { type: 'fb:ptd', ask: 'Thrown by' } },
    { type: 'fb:xp', label: 'Extra point', title: 'Extra point', pts: 1, tone: 'good' },
    { type: 'fb:two', label: '2-point', title: 'Two-point conversion', pts: 2, tone: 'good' },
    { type: 'fb:fg', label: 'Field goal', title: 'Field goal', pts: 3, tone: 'good' },
    { type: 'fb:sfty', label: 'Safety', title: 'Safety', pts: 2, tone: 'good', team: true },
    { type: 'fb:ptd', label: 'TD pass', title: 'Touchdown pass' },
    { type: 'fb:rush', label: 'Rush', title: 'Rush', amount: 'yards' },
    { type: 'fb:comp', label: 'Complete', title: 'Pass completed', amount: 'yards', also: { type: 'fb:rec', ask: 'Caught by' }, hint: 'Asks who threw it, how far it went, and then who caught it.' },
    { type: 'fb:rec', label: 'Catch', title: 'Catch', amount: 'yards' },
    { type: 'fb:inc', label: 'Incomplete', title: 'Pass incomplete' },
    { type: 'fb:int', label: 'INT thrown', title: 'Interception thrown', tone: 'bad' },
    { type: 'fb:fum', label: 'Fumble lost', title: 'Fumble lost', tone: 'bad' },
    { type: 'fb:tkl', label: 'Tackle', title: 'Tackle' },
    { type: 'fb:sack', label: 'Sack', title: 'Sack', tone: 'good' },
    { type: 'fb:dint', label: 'Interception', title: 'Interception', tone: 'good' },
    { type: 'fb:fr', label: 'Fumble won', title: 'Fumble recovered', tone: 'good' },
    { type: 'fb:pd', label: 'Pass broken up', title: 'Pass broken up' },
    { type: 'fb:pen', label: 'Penalty', title: 'Penalty', amount: 'yards', team: true, tone: 'bad' },
  ],
  groups: [
    { title: 'Scoring', plays: ['fb:td', 'fb:xp', 'fb:two', 'fb:fg', 'fb:sfty'] },
    { title: 'With the ball', note: 'A run or a pass asks how many yards. A loss is put in as a minus.', plays: ['fb:rush', 'fb:comp', 'fb:inc', 'fb:int', 'fb:fum'] },
    { title: 'On defense', plays: ['fb:tkl', 'fb:sack', 'fb:dint', 'fb:fr', 'fb:pd'] },
    { title: 'Flags', plays: ['fb:pen'] },
  ],
  them: ['fb:td', 'fb:xp', 'fb:two', 'fb:fg', 'fb:sfty'],
  columns: [
    { key: 'td', label: 'TD', name: 'Touchdowns', value: (t) => n(t, 'fb:td') },
    { key: 'pts', label: 'PTS', name: 'Points', value: (t) => 6 * n(t, 'fb:td') + n(t, 'fb:xp') + 2 * n(t, 'fb:two') + 3 * n(t, 'fb:fg') },
    { key: 'car', label: 'CAR', name: 'Carries', value: (t) => n(t, 'fb:rush') },
    { key: 'ryd', label: 'RUSH', name: 'Rushing yards', value: (t) => v(t, 'fb:rush') },
    { key: 'ypc', label: 'YPC', name: 'Yards per carry', ratio: true, show: 'dec', value: (t) => over(v(t, 'fb:rush'), n(t, 'fb:rush')) },
    { key: 'cmp', label: 'CMP', name: 'Passes completed', value: (t) => n(t, 'fb:comp') },
    { key: 'att', label: 'ATT', name: 'Passes thrown', value: passes },
    { key: 'pyd', label: 'PASS', name: 'Passing yards', value: (t) => v(t, 'fb:comp') },
    { key: 'ptd', label: 'P-TD', name: 'Touchdown passes', value: (t) => n(t, 'fb:ptd') },
    { key: 'int', label: 'INT', name: 'Interceptions thrown', value: (t) => n(t, 'fb:int') },
    { key: 'rec', label: 'REC', name: 'Catches', value: (t) => n(t, 'fb:rec') },
    { key: 'recyd', label: 'REC YD', name: 'Receiving yards', value: (t) => v(t, 'fb:rec') },
    { key: 'tkl', label: 'TKL', name: 'Tackles', value: (t) => n(t, 'fb:tkl', 'fb:sack') },
    { key: 'sack', label: 'SACK', name: 'Sacks', value: (t) => n(t, 'fb:sack') },
    { key: 'dint', label: 'D-INT', name: 'Interceptions', value: (t) => n(t, 'fb:dint') },
    { key: 'fr', label: 'FR', name: 'Fumbles recovered', value: (t) => n(t, 'fb:fr') },
    { key: 'pd', label: 'PBU', name: 'Passes broken up', value: (t) => n(t, 'fb:pd') },
  ],
  line: ['td', 'ryd', 'pyd', 'recyd', 'tkl'],
  wins: [
    { key: 'yds', name: 'Total yards', value: (g) => yards(g.us) },
    { key: 'ryd', name: 'Rushing yards', value: (g) => v(g.us, 'fb:rush') },
    { key: 'pyd', name: 'Passing yards', value: (g) => v(g.us, 'fb:comp') },
    { key: 'ypc', name: 'Yards per carry', value: (g) => over(v(g.us, 'fb:rush'), n(g.us, 'fb:rush')) },
    { key: 'cmp', name: 'Completion %', rate: true, value: (g) => { const c = over(n(g.us, 'fb:comp'), passes(g.us)); return c === null ? null : c * 100; } },
    { key: 'to', name: 'Turnovers', value: (g) => n(g.us, 'fb:int', 'fb:fum') },
    { key: 'take', name: 'Takeaways', value: (g) => n(g.us, 'fb:dint', 'fb:fr') },
    { key: 'tom', name: 'Turnover margin', value: (g) => n(g.us, 'fb:dint', 'fb:fr') - n(g.us, 'fb:int', 'fb:fum') },
    { key: 'sack', name: 'Sacks', value: (g) => n(g.us, 'fb:sack') },
    { key: 'tkl', name: 'Tackles', value: (g) => n(g.us, 'fb:tkl', 'fb:sack') },
    { key: 'pen', name: 'Penalties', value: (g) => n(g.us, 'fb:pen') },
    { key: 'penyd', name: 'Penalty yards', value: (g) => v(g.us, 'fb:pen') },
  ],
};

// ---------- Volleyball ----------

const swings = (t: Tally) => n(t, 'vb:kill', 'vb:ae', 'vb:att');
const hitting = (t: Tally) => over(n(t, 'vb:kill') - n(t, 'vb:ae'), swings(t));
const VOLLEYBALL: SportDef = {
  kind: 'volleyball',
  period: 'Set',
  periodName: (p) => `Set ${p}`,
  sets: true,
  plays: [
    { type: 'vb:kill', label: 'Kill', title: 'Kill', pts: 1, tone: 'good', also: { type: 'vb:ast', ask: 'Set by' } },
    { type: 'vb:ace', label: 'Ace', title: 'Ace', pts: 1, tone: 'good' },
    { type: 'vb:blk', label: 'Block', title: 'Block', pts: 1, tone: 'good' },
    { type: 'vb:oe', label: 'Their error', title: 'Their error', pts: 1, tone: 'good', team: true, hint: 'A point from their mistake: a ball hit out, a serve into the net.' },
    { type: 'vb:pt', label: 'Point', title: 'Point', pts: 1, team: true },
    { type: 'vb:ae', label: 'Attack error', title: 'Attack error', pts: 1, other: true, tone: 'bad' },
    { type: 'vb:se', label: 'Serve error', title: 'Service error', pts: 1, other: true, tone: 'bad' },
    { type: 'vb:re', label: 'Pass error', title: 'Reception error', pts: 1, other: true, tone: 'bad', hint: 'Aced, or a serve passed so it could not be played.' },
    { type: 'vb:err', label: 'Other error', title: 'Error', pts: 1, other: true, tone: 'bad', hint: 'In the net, a double, a lift, out of rotation.' },
    { type: 'vb:att', label: 'Attack', title: 'Attack kept in play', hint: 'A swing that was dug or kept in play. With kills and attack errors it makes the hitting percentage.' },
    { type: 'vb:dig', label: 'Dig', title: 'Dig' },
    { type: 'vb:ast', label: 'Assist', title: 'Assist' },
    { type: 'vb:srv', label: 'Serve in', title: 'Serve in' },
  ],
  groups: [
    { title: 'Our point', plays: ['vb:kill', 'vb:ace', 'vb:blk', 'vb:oe'] },
    { title: 'Their point, from our error', note: 'Each of these gives them the point.', plays: ['vb:ae', 'vb:se', 'vb:re', 'vb:err'] },
    { title: 'Rally still on', plays: ['vb:att', 'vb:dig', 'vb:ast', 'vb:srv'] },
  ],
  them: ['vb:pt'],
  columns: [
    { key: 'pts', label: 'PTS', name: 'Points won', value: (t) => n(t, 'vb:kill', 'vb:ace', 'vb:blk') },
    { key: 'k', label: 'K', name: 'Kills', value: (t) => n(t, 'vb:kill') },
    { key: 'e', label: 'E', name: 'Attack errors', value: (t) => n(t, 'vb:ae') },
    { key: 'ta', label: 'TA', name: 'Attacks', value: swings },
    { key: 'hit', label: 'HIT%', name: 'Hitting percentage', ratio: true, show: 'avg', value: hitting },
    { key: 'a', label: 'A', name: 'Assists', value: (t) => n(t, 'vb:ast') },
    { key: 'ace', label: 'ACE', name: 'Aces', value: (t) => n(t, 'vb:ace') },
    { key: 'se', label: 'SE', name: 'Service errors', value: (t) => n(t, 'vb:se') },
    { key: 'dig', label: 'DIG', name: 'Digs', value: (t) => n(t, 'vb:dig') },
    { key: 'blk', label: 'BLK', name: 'Blocks', value: (t) => n(t, 'vb:blk') },
    { key: 're', label: 'RE', name: 'Reception errors', value: (t) => n(t, 'vb:re') },
  ],
  line: ['k', 'ace', 'blk', 'dig', 'a'],
  wins: [
    { key: 'hit', name: 'Hitting %', rate: true, value: (g) => { const h = hitting(g.us); return h === null ? null : h * 100; } },
    { key: 'k', name: 'Kills', value: (g) => n(g.us, 'vb:kill') },
    { key: 'ae', name: 'Attack errors', value: (g) => n(g.us, 'vb:ae') },
    { key: 'ace', name: 'Aces', value: (g) => n(g.us, 'vb:ace') },
    { key: 'se', name: 'Service errors', value: (g) => n(g.us, 'vb:se') },
    { key: 'blk', name: 'Blocks', value: (g) => n(g.us, 'vb:blk') },
    { key: 'dig', name: 'Digs', value: (g) => n(g.us, 'vb:dig') },
    { key: 'a', name: 'Assists', value: (g) => n(g.us, 'vb:ast') },
    { key: 're', name: 'Reception errors', value: (g) => n(g.us, 'vb:re') },
    { key: 'own', name: 'Points given away', value: (g) => n(g.us, 'vb:ae', 'vb:se', 'vb:re', 'vb:err') },
    { key: 'oe', name: 'Their errors', value: (g) => n(g.us, 'vb:oe') },
  ],
};

export const SPORT_DEFS: Record<ScoredSport, SportDef> = { baseball: BASEBALL, football: FOOTBALL, volleyball: VOLLEYBALL };
/** The sport a kind of playbook is scored as, or null for one that is scored on the basketball pad. */
export const sportDef = (kind: string | null | undefined): SportDef | null => (kind && kind in SPORT_DEFS ? SPORT_DEFS[kind as ScoredSport] : null);
const BY_TYPE = new Map<string, { def: SportDef; play: SportPlay }>();
for (const def of Object.values(SPORT_DEFS)) for (const play of def.plays) BY_TYPE.set(play.type, { def, play });
export const playOf = (type: string): SportPlay | null => BY_TYPE.get(type)?.play ?? null;
/** The sport a list of plays is of, told from the plays themselves. Null for basketball's, and for none. */
export const sportOfEvents = (events: { type: string }[]): SportDef | null => {
  for (const e of events) {
    const hit = BY_TYPE.get(e.type);
    if (hit) return hit.def;
  }
  return null;
};
/** What every play is worth: a minus is points for the other side. The server keeps the same list. */
export const SPORT_POINTS: Record<string, number> = Object.fromEntries([...BY_TYPE.values()].map(({ play }) => [play.type, (play.other ? -1 : 1) * (play.pts ?? 0)]));
/** Who a play scores for, and how many. */
export function credit(e: { side: 'us' | 'them'; type: string }): { side: 'us' | 'them'; pts: number } | null {
  const p = SPORT_POINTS[e.type];
  if (!p) return null;
  return { side: p > 0 ? e.side : e.side === 'us' ? 'them' : 'us', pts: Math.abs(p) };
}

/** The points each side scored in each part of the game. */
export function byPart(events: SportEvent[], upTo = 1): { us: number; them: number }[] {
  const out = Array.from({ length: Math.max(upTo, 1) }, () => ({ us: 0, them: 0 }));
  for (const e of events) {
    const c = credit(e);
    if (!c) continue;
    while (out.length < e.period) out.push({ us: 0, them: 0 });
    out[e.period - 1][c.side] += c.pts;
  }
  return out;
}
/**
 * The score. For most games it is the points added up. For one won by sets it is the sets each
 * side has won: a set counts once the game has moved past it, or is over, and `points` is then
 * how the set being played stands.
 */
export function sportScore(def: SportDef, events: SportEvent[], state: { period: number; status: 'live' | 'final' }): { us: number; them: number; points: { us: number; them: number }; parts: { us: number; them: number }[] } {
  const parts = byPart(events, state.period);
  const total = { us: parts.reduce((s, p) => s + p.us, 0), them: parts.reduce((s, p) => s + p.them, 0) };
  if (!def.sets) return { ...total, points: total, parts };
  let us = 0;
  let them = 0;
  parts.forEach((p, i) => {
    if (i + 1 >= state.period && state.status !== 'final') return;
    if (p.us > p.them) us++;
    else if (p.them > p.us) them++;
  });
  return { us, them, points: parts[Math.min(state.period, parts.length) - 1] ?? { us: 0, them: 0 }, parts };
}

/** The plays of one side counted up, for the side as a whole and for each of its players. */
export function tallyOf(events: SportEvent[], side: 'us' | 'them'): { total: Tally; players: Map<number, Tally> } {
  const total = emptyTally();
  const players = new Map<number, Tally>();
  for (const e of events) {
    if (e.side !== side || !BY_TYPE.has(e.type)) continue;
    if (e.player !== null && !players.has(e.player)) players.set(e.player, emptyTally());
    for (const t of e.player === null ? [total] : [total, players.get(e.player)!]) {
      t.n[e.type] = (t.n[e.type] || 0) + 1;
      if (typeof e.v === 'number') t.v[e.type] = (t.v[e.type] || 0) + e.v;
    }
  }
  return { total, players };
}
export function sumTallies(list: Tally[]): Tally {
  const out = emptyTally();
  for (const t of list) {
    for (const [k, x] of Object.entries(t.n)) out.n[k] = (out.n[k] || 0) + x;
    for (const [k, x] of Object.entries(t.v)) out.v[k] = (out.v[k] || 0) + x;
  }
  return out;
}
/** A stat as it is written in a table. `games`, when given, makes a number that adds up into one per game. */
export function statText(stat: SportStat, t: Tally, games?: number): string {
  const x = stat.value(t);
  if (x === null) return '–';
  if (stat.show === 'avg') return x.toFixed(3).replace(/^(-?)0\./, '$1.');
  if (stat.show === 'pct') return `${Math.round(x * 100)}%`;
  if (stat.show === 'dec') return x.toFixed(1);
  return games ? (x / Math.max(1, games)).toFixed(1) : String(x);
}
/** A player summed up in a line: "2 H · 4 AB · 1 R". */
export function lineText(def: SportDef, t: Tally): string {
  return def.line
    .map((key) => def.columns.find((c) => c.key === key)!)
    .map((c) => `${statText(c, t)} ${c.label}`)
    .join(' · ');
}
/** A play as a line to read: "Home run", or "Rush, 12 yards". */
export function playText(e: SportEvent): string {
  const p = playOf(e.type);
  if (!p) return 'Play';
  if (p.amount && typeof e.v === 'number') return `${p.title}, ${e.v === 0 ? 'no gain' : `${Math.abs(e.v)} ${Math.abs(e.v) === 1 ? p.amount.replace(/s$/, '') : p.amount}${e.v < 0 ? ' lost' : ''}`}`;
  return p.title;
}
