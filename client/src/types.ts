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
  parent_phone: string;
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
  court: 'half' | 'full';
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
  intro_html: string;
  is_template: boolean;
  /** A game-day plan: built like a practice, left out of dashboard category totals. */
  is_game: boolean;
  assigned: number[];
  updated_at: string;
  items: Item[];
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
