// Which way of keeping score a team's sport gets: basketball's own pad, or the one shared by the
// other sports, laid out for that sport (sportScoring.ts).
import { periodName } from './scoring';
import { sportKind } from './sports';
import { sportDef, sportOfEvents, type SportDef } from './sportScoring';

/** How a sport, by its name, is scored on the shared pad. Null for basketball, and for a sport with no pad of its own, which get basketball's. */
export const scoringFor = (sportName: string | undefined): SportDef | null => sportDef(sportKind(sportName));
/** The same, for a game whose sport is not known, told from its plays. */
export const scoringOfPlays = (events: { type: string }[]): SportDef | null => sportOfEvents(events);
/** The same again, from the letters a sport's plays begin with, which is how a score sent to a follower says its sport. */
export const scoringOfCode = (code: string | undefined): SportDef | null => sportDef(code === 'bb' ? 'baseball' : code === 'fb' ? 'football' : code === 'vb' ? 'volleyball' : null);
/** A part of a game, short: "Q2", "H1", "Inn 3", "Set 2". */
export const partName = (def: SportDef | null, p: number, halves = false) => (def ? def.periodName(p) : periodName(p, halves));
