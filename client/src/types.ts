export interface Sport {
  id: number;
  name: string;
}
export interface Team {
  id: number;
  sport_id: number;
  name: string;
  season: string;
  notes: string;
  /** Calendar subscription link (GameChanger and similar), or ''. */
  calendar_url: string;
  calendar_synced_at: string;
}
/** A game, practice or other event read from the team's linked calendar. */
export interface ScheduleEvent {
  id: number;
  kind: 'practice' | 'game' | 'other';
  title: string;
  date: string;
  start_time: string;
  end_time: string;
  location: string;
  notes: string;
}
export interface Tag {
  id: number;
  sport_id: number;
  name: string;
  color: string;
  /** Default target share of practice time, in percent. */
  target_pct: number | null;
  /** Overrides of the default for one tracking period. A missing key uses target_pct. */
  targets: Partial<Record<'practice' | 'week' | 'month' | 'season', number>>;
}
export interface Player {
  id: number;
  team_id: number;
  name: string;
  number: string;
  position: string;
  grade: string;
  parent_name: string;
  parent_email: string;
  notes: string;
  active: number;
}
export interface Member {
  player_id: number;
  /** Position or job within this drill, e.g. "PG" or "Screener". */
  role: string;
}
/** A station or squad inside an item. Prints as one column. */
export interface Group {
  name: string;
  notes_html: string;
  members: Member[];
}
export interface PlayerNote {
  player_id: number;
  note: string;
}
/** A player, defender, ball, cone or text label on the court. Positions are in feet. */
export interface PlayMark {
  id: string;
  type: 'o' | 'x' | 'ball' | 'cone' | 'text';
  x: number;
  y: number;
  label: string;
  /** A player's own color. Absent means the default ink. */
  color?: string;
  /** This player has the ball, and is drawn circled. */
  hasBall?: boolean;
  /** Text labels only: letter height in feet on the court. Absent means the standard size. */
  size?: number;
  /** Text labels only: the typeface. Absent means the app's own sans-serif. */
  font?: 'serif' | 'mono' | 'hand';
  /** Text labels only: false for regular weight. Labels are bold unless this says otherwise. */
  bold?: boolean;
  /** Text labels only. */
  italic?: boolean;
  /** Text labels only: the width of the label's box in feet. The words wrap to fit it. Absent means one line, as wide as the words. */
  w?: number;
}
/** A movement line: start, a point it bends through, and end. */
export interface PlayLine {
  id: string;
  type: 'line';
  kind: 'cut' | 'pass' | 'dribble' | 'screen';
  points: number[][];
  /** The player or ball this line starts from, by id. The start follows it when it moves. */
  from?: string;
  /** The player, ball or basket ("basket", "basket2") this line ends at. */
  to?: string;
  /** Its place in the step's order of movement, from 2 up. Absent means first. Lines sharing a place move together. */
  order?: number;
}
/** A filled shape, such as a zone. A box or triangle is its corners; an oval is two opposite corners of its box. */
export interface PlayShape {
  id: string;
  type: 'shape';
  shape: 'rect' | 'ellipse' | 'triangle';
  points: number[][];
  color: string;
  /** 0 (invisible) to 1 (solid). */
  opacity: number;
}
export type PlayObject = PlayMark | PlayLine | PlayShape;
/** One step of a play. */
export interface PlayFrame {
  note: string;
  objects: PlayObject[];
}
export interface Play {
  id: number;
  sport_id: number;
  name: string;
  /** The kind of play, such as "Man offense" or "Baseline out of bounds". */
  category: string;
  /** Free-form tags, such as "vs 2-3 zone". */
  labels: string[];
  /** What the play is drawn on: a basketball court, a baseball field or a football field. See sports.ts. */
  court: 'half' | 'full' | 'infield' | 'diamond' | 'gridiron' | 'redzone' | 'vfull' | 'vhalf';
  /** Half court only: true when the basket is drawn at the bottom. */
  flipped: boolean;
  notes: string;
  frames: PlayFrame[];
  images: ItemImage[];
  videos: ItemVideo[];
  links: ItemLink[];
  updated_at: string;
}
/** A picture on an item or drill, such as a play diagram. */
export interface ItemImage {
  id: number;
  /** Printed width, as a percent of the sheet. */
  width_pct: number;
  caption: string;
}
/** A web link, such as a video of the drill being run. */
export interface ItemLink {
  url: string;
  label: string;
}
/** An uploaded video clip. */
export interface ItemVideo {
  id: number;
  caption: string;
}
/** One entry on the Resources page: something saved there, or gathered from a drill, play or practice. */
export interface Resource {
  /** Stable identity: the address for a link, the file for a picture or video. */
  key: string;
  kind: 'link' | 'image' | 'video';
  title: string;
  url: string;
  file_id: number | null;
  /** Set when it was saved to Resources directly; null when it only exists on a drill, play or practice. */
  resource_id: number | null;
  created_at: string;
  uses: { type: 'drill' | 'play' | 'practice'; id: number; name: string }[];
}
/** The shared shape of a practice item and a library drill. */
export interface ItemContent {
  title: string;
  duration_min: number;
  notes_html: string;
  coach_notes_html: string;
  callout: string;
  groups: Group[];
  images: ItemImage[];
  /** Plays from the playbook attached for reference. */
  play_ids: number[];
  links: ItemLink[];
  videos: ItemVideo[];
  tag_ids: number[];
}
export interface Item extends ItemContent {
  /** Client-only identity, stable across saves. */
  key: string;
  kind: 'item' | 'break';
  reps: string;
  player_notes: PlayerNote[];
  drill_id: number | null;
  /** Runs at the same time as the item before it: the two share one time slot, for when the team splits up. */
  beside?: boolean;
}
export type PlanKind = 'practice' | 'homework';
export interface Plan {
  id: number;
  team_id: number;
  kind: PlanKind;
  title: string;
  date: string;
  start_time: string;
  location: string;
  /** The coach's own jottings for this plan: plain text. */
  notes: string;
  /** Whether the notes go on the printed sheet. On unless the coach turns it off. */
  print_notes: boolean;
  intro_html: string;
  is_template: boolean;
  /** A game: shown as a game plan, and left out of dashboard category totals. The practice items are kept all the same. */
  is_game: boolean;
  /** The game side of the plan. Kept whether or not the plan is currently marked as a game. */
  game?: GamePlan;
  assigned: number[];
  updated_at: string;
  items: Item[];
}
/** How a coach thinks about substituting in one game: by period, or at set times on the clock. */
export interface GameSubs {
  mode: 'periods' | 'time';
  /** What a period is called: Quarter, Half, Inning, Set, Period. */
  unit: string;
  /** How many periods. */
  count: number;
  /** Minutes in a period. 0 when it is not timed. */
  minutes: number;
  /** By the clock: how long the game is, and how often players change. */
  game_minutes: number;
  every: number;
  /** Players on the court or field at once. */
  on: number;
}
/** Everything in a game plan. Every part is optional: a new game has none of it. */
export interface GamePlan {
  opponent?: string;
  side?: 'home' | 'away' | 'neutral' | '';
  /** When to be there, as "17:00". */
  arrive?: string;
  uniform?: string;
  bring?: string;
  /** Players marked out or late, by player id. Anyone not listed is in. */
  availability?: Record<string, 'out' | 'late'>;
  subs?: Partial<GameSubs>;
  /** For each stretch of play, the ids of the players who are on. */
  lineup?: number[][];
  /** Baseball and softball: the batting order, and each batter's position. */
  batting?: number[];
  positions?: Record<string, string>;
  keys?: { offense: string[]; defense: string[]; focus: string };
  plays?: { situation: string; play_ids: number[] }[];
  matchups?: { player_id: number; opponent: string; note: string }[];
  warmup?: { title: string; minutes: number }[];
  scouting?: string;
  result?: { us: string; them: string; went_well: string; work_on: string };
  /** Set once the opponent was read from the team calendar, so it is only done the first time. */
  prefilled?: boolean;
}
/** What the AI import returns for one uploaded plan. Nothing is saved until the coach confirms. */
export interface ImportDraft {
  title: string;
  date: string;
  start_time: string;
  location: string;
  items: {
    kind: 'item' | 'break';
    title: string;
    duration_min: number;
    notes_html: string;
    callout: string;
    groups: { name: string; notes_html: string; player_names: string[] }[];
    tags: string[];
  }[];
  new_tags: { name: string; reason: string }[];
  warnings: string[];
}
export type PlanSummary = Omit<Plan, 'items'>;
export interface Drill {
  id: number;
  sport_id: number;
  name: string;
  duration_min: number;
  notes_html: string;
  coach_notes_html: string;
  callout: string;
  groups: Group[];
  images: ItemImage[];
  play_ids: number[];
  links: ItemLink[];
  videos: ItemVideo[];
  tag_ids: number[];
}

/** What a team's owner can let a helper do. All but `contacts` are about changing things; `contacts` is about seeing them. */
export type TeamPerm = 'plans' | 'drills' | 'plays' | 'resources' | 'roster' | 'schedule' | 'contacts' | 'manage';
export type TeamPerms = Record<TeamPerm, boolean>;
/** A team someone else owns and has shared with the signed-in person. */
export interface SharedTeam {
  id: number;
  name: string;
  season: string;
  /** The sport's name, such as "Basketball". */
  sport: string;
  /** What the owner calls this person on the team, such as "Assistant coach". */
  title: string;
  owner_name: string;
  perms: TeamPerms;
}
/** Set while working inside a shared team. */
export interface TeamAccess {
  /** True when this is the system administrator looking in, not someone the team was shared with. */
  system?: boolean;
  team_id: number;
  owner_name: string;
  title: string;
  perms: TeamPerms;
}
/** Someone a team is shared with, as its owner sees them. */
export interface StaffMember {
  user_id: number;
  name: string;
  email: string;
  title: string;
  added_at: string;
  perms: TeamPerms;
}
