import type { Drill, ImportDraft, Item, Plan, PlanKind, PlanSummary, Play, Player, Resource, ScheduleEvent, SharedTeam, Sport, StaffMember, Tag, Team, TeamAccess, TeamPerms } from './types';

/** Fired when the server says the session is gone, so the app can show the sign-in screen. */
export const SIGNED_OUT_EVENT = 'practiceplan:signed-out';

async function req<T>(method: string, url: string, body?: unknown): Promise<T> {
  const res = await fetch('/api' + url, {
    method,
    // A delete still on its way when the tab closes is allowed to finish.
    keepalive: method === 'DELETE',
    headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!res.ok) {
    if (res.status === 401 && !url.startsWith('/auth/')) window.dispatchEvent(new Event(SIGNED_OUT_EVENT));
    let msg = `Request failed (${res.status})`;
    try {
      msg = (await res.json()).error || msg;
    } catch {
      /* keep the generic message */
    }
    throw new Error(msg);
  }
  return res.json();
}

let keySeq = 0;
export const newKey = () => `k${Date.now().toString(36)}-${keySeq++}`;
const withKeys = (p: Plan): Plan => ({ ...p, items: (p.items || []).map((it) => ({ ...it, images: it.images || [], play_ids: it.play_ids || [], links: it.links || [], videos: it.videos || [], key: newKey() })) });

export interface Bootstrap {
  sports: Sport[];
  /** Teams in the workspace being worked in. Inside a shared team, just that team. */
  teams: Team[];
  tags: Tag[];
  /** The signed-in person's own teams, wherever they are working right now. */
  own_teams: (Pick<Team, 'id' | 'name' | 'season'> & { sport: string })[];
  shared_teams: SharedTeam[];
  /** Null in your own workspace. */
  access: TeamAccess | null;
  /** On when an administrator has turned on keyboard accessibility: buttons appear for things otherwise done by dragging. */
  keyboard_access: boolean;
}

/** Whether the Claude Code program is installed on this computer for automatic plan import. */
export interface AiStatus {
  available: boolean;
  version: string;
}
/** An uploaded file as base64, or pasted text. */
export type ImportSource = { name: string; media_type: string; data: string } | { text: string };

export interface User {
  id: number;
  email: string;
  name: string;
  /** Administrator of the whole system. */
  is_admin: boolean;
  /** Plan import, granted per user by the administrator. */
  can_import: boolean;
  /** The one account that runs the whole system: other people's accounts and their upload space. */
  is_system_admin: boolean;
  must_change_password: boolean;
  /** Personal display preferences, saved with the account. */
  prefs: { heat_color?: string; /** True once the welcome tour has been finished or skipped. */ tour_done?: boolean };
}
export interface AuthStatus {
  /** True on a fresh install with no accounts yet. */
  setup_needed: boolean;
  registration_open: boolean;
  /** 'open' lets people straight in. 'verify' sends a confirmation link first. */
  registration_mode: 'closed' | 'open' | 'verify';
  user: User | null;
}
export interface AdminUser extends User {
  status: 'pending' | 'active' | 'disabled';
  created_at: string;
  last_login_at: string | null;
  teams: number;
}
/** A person as the system administrator sees them, with their upload space. */
export interface SystemUser extends AdminUser {
  used_bytes: number;
  files: number;
  /** Their own cap in MB, or null when the default applies. */
  upload_cap_mb: number | null;
  /** The cap in force for them, in MB. */
  cap_mb: number;
  /** How many times they have signed in, and the seconds they have spent using the app. */
  sign_ins: number;
  active_seconds: number;
  /** The last time they did anything, or null if never. */
  last_seen_at: string | null;
}
/** One sign-in: when it began, when the person was last seen in it, and how it ended. */
export interface SignIn {
  id: number;
  started_at: string;
  last_seen_at: string;
  ended_at: string | null;
  active_seconds: number;
  ip: string;
  device: string;
  state: 'open' | 'signed_out' | 'expired';
}
export interface UserActivity {
  user: SystemUser;
  /** Teams they own or help with. `role` is "Owner" or their title on the team. */
  teams: { id: number; name: string; season: string; sport: string; role: string }[];
  logins: SignIn[];
  sign_ins: number;
  active_seconds: number;
  longest_seconds: number;
  sign_ins_30d: number;
  days_active_30d: number;
  built: { teams: number; practices: number; homework: number; drills: number; plays: number; communities: number; shared_teams: number; last_plan_edit: string | null };
}
/** What deleting an account would remove. */
export interface AccountDeletion {
  teams: number;
  plans: number;
  drills: number;
  plays: number;
  files: number;
  helpers: number;
  kept_teams: string[];
  communities_passed_on: string[];
  communities_deleted: string[];
}
export interface SystemState {
  default_cap_mb: number;
  max_cap_mb: number;
  total_bytes: number;
  users: SystemUser[];
  online_now: number;
  sign_ins_7d: number;
  active_people_7d: number;
  new_accounts_30d: number;
}
export interface StorageSpace {
  used_bytes: number;
  files: number;
  cap_bytes: number;
  left_bytes: number;
}
export type ShareKind = 'drill' | 'play' | 'plan';
/**
 * One line on the Messages page: an invitation, a message or a shared thing in one of the caller's
 * communities, or a "notice", which is a message from the app itself (added to a team, and so on).
 */
export interface CommunityNewsItem {
  key: string;
  kind: 'invite' | 'post' | 'share' | 'notice';
  /** Notices only: its id, its headline, and where clicking it goes ('' for nowhere). */
  id?: number;
  title?: string;
  link?: string;
  share_kind?: ShareKind;
  community_id: number;
  community: string;
  /** When it happened, as the database writes it: "2026-11-12 19:04:11", in UTC. */
  at: string;
  by: string;
  /** The message itself, or the name of what was shared. */
  text: string;
  unread: boolean;
}
export interface CommunityNews {
  unread: number;
  items: CommunityNewsItem[];
}
export interface Community {
  id: number;
  name: string;
  description: string;
  /** What members may share, each turned on separately by the community's admins. */
  share_drills: boolean;
  share_plays: boolean;
  share_plans: boolean;
  require_approval: boolean;
  /** The caller's place in it. */
  role: 'creator' | 'admin' | 'member';
  status: 'active' | 'invited';
  /** A small picture, as a data URL, or empty. */
  image: string;
  /** What the caller may do here beyond taking part. The creator may do all of it. */
  can: CommunityPowers;
  members: number;
  created_by_name: string;
}
/** The jobs a community's creator can hand to an admin, each on its own. */
export type CommunityPower = 'moderate' | 'approve' | 'settings' | 'people';
export type CommunityPowers = Record<CommunityPower, boolean>;
export interface CommunityPerson {
  id: number;
  name: string;
  /** Only sent to community admins. */
  email?: string;
  role: 'creator' | 'admin' | 'member';
  status: 'active' | 'invited';
  perms: CommunityPowers;
}
export interface CommunityDetail extends Community {
  join_code?: string;
  people: CommunityPerson[];
  pending_shares: number;
}
export interface CommunityPost {
  id: number;
  body: string;
  created_at: string;
  by: string;
  by_id: number;
  mine: boolean;
  can_delete: boolean;
  /** Set on a reply to a message. */
  parent_id?: number | null;
  /** Set on a reply to something shared. */
  share_id?: number | null;
  /** The replies to it, oldest first. Replies carry their own in the same way. */
  replies?: CommunityPost[];
  /** Something the writer shared along with it. */
  attach_share_id?: number | null;
  /** When the writer last changed it, if they ever did. */
  edited_at?: string | null;
}
export interface CommunityShare {
  id: number;
  community_id: number;
  community_name: string;
  kind: ShareKind;
  status: 'pending' | 'approved';
  title: string;
  summary: string;
  by: string;
  by_id: number;
  mine: boolean;
  item_id?: number;
  shared_at: string;
  /** What to draw on its card: a play's first step, or the first lines of a practice. */
  art?: { play?: Pick<Play, 'court' | 'flipped'> & { frame: Play['frames'][number] }; lines?: { kind: 'item' | 'break'; title: string; duration_min: number }[]; text?: string };
  tags: { name: string; color: string }[];
}
type SharedLink = { url: string; label: string };
type SharedTag = { name: string; color: string };
export interface SharedPlay extends Pick<Play, 'id' | 'name' | 'category' | 'labels' | 'court' | 'flipped' | 'notes' | 'frames'> {
  links: SharedLink[];
}
export interface SharedDrill {
  name: string;
  duration_min: number;
  notes_html: string;
  groups: { name: string; notes_html: string }[];
  links: SharedLink[];
  tags: SharedTag[];
  plays: SharedPlay[];
}
export interface SharedPlan {
  title: string;
  kind: PlanKind;
  is_game: boolean;
  start_time: string;
  intro_html: string;
  items: { kind: 'item' | 'break'; title: string; duration_min: number; notes_html: string; reps: string; links: SharedLink[]; tags: SharedTag[]; plays: SharedPlay[] }[];
}
export interface CommunityShareDetail extends CommunityShare {
  content: SharedDrill | SharedPlay | SharedPlan;
}
/** A message in the discussion on one practice. Replies carry their own replies in the same way. */
export interface PlanPost {
  id: number;
  body: string;
  created_at: string;
  by: string;
  by_id: number;
  mine: boolean;
  can_delete: boolean;
  parent_id: number | null;
  /** When the writer last changed it, if they ever did. */
  edited_at: string | null;
  replies: PlanPost[];
}
/** Someone who works on a plan's team. Everyone listed can read it and join its discussion. */
export interface PlanCollaborator {
  id: number;
  name: string;
  /** "Owner", or the title they were given on the team. */
  role: string;
  owner: boolean;
  /** Whether they may change the plan, or only read and discuss it. */
  can_edit: boolean;
  you: boolean;
}
/** Something published in the coach library, for every coach to take a copy of. */
export interface LibraryItem {
  id: number;
  kind: ShareKind;
  sport: string;
  title: string;
  summary: string;
  description: string;
  tags: SharedTag[];
  /** The packs it is in. */
  packs: number[];
  published_at: string;
  /** Only sent to the system administrator. */
  adds?: number;
  source_item_id?: number;
}
export interface LibraryPack {
  id: number;
  name: string;
  description: string;
  sport: string;
  item_ids: number[];
}
export interface CoachLibrary {
  can_manage: boolean;
  items: LibraryItem[];
  packs: LibraryPack[];
}
type PackFields = { name: string; description: string; sport: string; item_ids: number[] };
/** For one of the caller's own things: a community of theirs, and whether it is shared there. */
export interface MyShareState {
  community_id: number;
  name: string;
  allowed: boolean;
  share_id: number | null;
  status: 'pending' | 'approved' | null;
}
export interface AdminSettings {
  registration_mode: 'closed' | 'open' | 'verify';
  keyboard_access: boolean;
  registration_enabled: boolean;
  registration_open: boolean;
  mailer: { configured: boolean; transport: string };
  unsent_emails: number;
}

export const api = {
  authStatus: () => req<AuthStatus>('GET', '/auth/status'),
  setup: (b: { name: string; email: string; password: string; setup_token?: string }) => req<{ user: User }>('POST', '/auth/setup', b),
  login: (email: string, password: string) => req<{ user: User }>('POST', '/auth/login', { email, password }),
  logout: () => req('POST', '/auth/logout', {}),
  register: (b: { name: string; email: string; password: string }) => req<{ ok: true; user?: User }>('POST', '/auth/register', b),
  confirm: (token: string) => req('POST', '/auth/confirm', { token }),
  savePrefs: (prefs: { heat_color?: string | null; tour_done?: boolean }) => req<{ user: User }>('PUT', '/auth/prefs', prefs),
  changePassword: (current: string, next: string) => req<{ user: User }>('POST', '/auth/password', { current, next }),

  adminUsers: () => req<AdminUser[]>('GET', '/admin/users'),
  adminCreateUser: (b: { name: string; email: string; password: string; can_import: boolean }) => req<AdminUser>('POST', '/admin/users', b),
  adminUpdateUser: (id: number, b: { can_import?: boolean; status?: 'active' | 'disabled'; password?: string }) =>
    req<AdminUser>('PUT', `/admin/users/${id}`, b),
  adminSettings: () => req<AdminSettings>('GET', '/admin/settings'),
  system: () => req<SystemState>('GET', '/system'),
  systemDeletion: (id: number) => req<AccountDeletion>('GET', `/system/users/${id}/deletion`),
  systemDeleteUser: (id: number, confirmEmail: string) => req<SystemState>('DELETE', `/system/users/${id}`, { confirm_email: confirmEmail }),
  systemUserActivity: (id: number) => req<UserActivity>('GET', `/system/users/${id}/activity`),
  systemSetDefaults: (b: { default_cap_mb: number }) => req<SystemState>('PUT', '/system/settings', b),
  systemUpdateUser: (id: number, b: { upload_cap_mb?: number | null; is_admin?: boolean; password?: string; must_change?: boolean }) => req<SystemState>('PUT', `/system/users/${id}`, b),
  storage: () => req<StorageSpace>('GET', '/storage'),
  /** First visit only: fills an empty site from a backup file made by another copy of Dime Coach. */
  restore: async (file: File, setupToken: string) => {
    const res = await fetch('/api/auth/restore', { method: 'POST', headers: { 'Content-Type': 'application/octet-stream', 'X-Setup-Token': setupToken }, body: file });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(body.error || `Request failed (${res.status})`);
    return body as { ok: true; accounts: number };
  },
  communities: () => req<Community[]>('GET', '/communities'),
  communityNews: () => req<CommunityNews>('GET', '/communities/news'),
  messages: () => req<CommunityNews>('GET', '/messages'),
  /** Marks one message from the app, or with no id everything, as read. */
  markMessagesRead: (id?: number) => req<CommunityNews>('POST', id ? `/messages/${id}/read` : '/messages/read', {}),
  /** Marks one community, or with no id all of them, as read up to now. */
  markCommunitySeen: (id?: number) => req<CommunityNews>('POST', id ? `/communities/${id}/seen` : '/communities/seen', {}),
  createCommunity: (b: { name: string; description: string }) => req<CommunityDetail>('POST', '/communities', b),
  joinCommunity: (code: string) => req<Community>('POST', '/communities/join', { code }),
  community: (id: number) => req<CommunityDetail>('GET', `/communities/${id}`),
  updateCommunity: (id: number, b: Partial<Pick<Community, 'name' | 'description' | 'share_drills' | 'share_plays' | 'share_plans' | 'require_approval' | 'image'>>) =>
    req<CommunityDetail>('PUT', `/communities/${id}`, b),
  /** `confirm` is the community's name, typed out. */
  deleteCommunity: (id: number, confirm: string) => req<{ ok: true }>('DELETE', `/communities/${id}`, { confirm }),
  setMemberPowers: (id: number, userId: number, perms: Partial<CommunityPowers>) => req<CommunityDetail>('PUT', `/communities/${id}/members/${userId}`, { perms }),
  newJoinCode: (id: number) => req<CommunityDetail>('POST', `/communities/${id}/code`, {}),
  inviteToCommunity: (id: number, email: string) => req<CommunityDetail>('POST', `/communities/${id}/invite`, { email }),
  acceptInvite: (id: number) => req<{ ok: true }>('POST', `/communities/${id}/accept`, {}),
  setMemberRole: (id: number, userId: number, role: 'admin' | 'member') => req<CommunityDetail>('PUT', `/communities/${id}/members/${userId}`, { role }),
  /** Removes someone, declines an invitation, or leaves, depending on who asks about whom. */
  removeMember: (id: number, userId: number) => req<{ ok: true }>('DELETE', `/communities/${id}/members/${userId}`),
  communityPosts: (id: number) => req<CommunityPost[]>('GET', `/communities/${id}/posts`),
  postToCommunity: (id: number, body: string, to?: { parent_id?: number; share_id?: number; attach_share_id?: number }) =>
    req<CommunityPost[]>('POST', `/communities/${id}/posts`, { body, ...to }),
  editPost: (id: number, postId: number, body: string) => req<CommunityPost[]>('PUT', `/communities/${id}/posts/${postId}`, { body }),
  deletePost: (id: number, postId: number) => req<CommunityPost[]>('DELETE', `/communities/${id}/posts/${postId}`),
  communityShares: (id: number) => req<CommunityShare[]>('GET', `/communities/${id}/shares`),
  share: (id: number, kind: ShareKind, itemId: number) => req<CommunityShare[]>('POST', `/communities/${id}/shares`, { kind, item_id: itemId }),
  unshare: (shareId: number) => req<CommunityShare[]>('DELETE', `/community-shares/${shareId}`),
  approveShare: (shareId: number) => req<CommunityShare[]>('POST', `/community-shares/${shareId}/approve`, {}),
  myShares: (kind: ShareKind, itemId: number) => req<MyShareState[]>('GET', `/community-shares/mine?kind=${kind}&item_id=${itemId}`),
  planCollaborators: (planId: number) => req<PlanCollaborator[]>('GET', `/plans/${planId}/collaborators`),
  planPosts: (planId: number) => req<PlanPost[]>('GET', `/plans/${planId}/posts`),
  postToPlan: (planId: number, body: string, parentId?: number) => req<PlanPost[]>('POST', `/plans/${planId}/posts`, { body, parent_id: parentId }),
  editPlanPost: (planId: number, postId: number, body: string) => req<PlanPost[]>('PUT', `/plans/${planId}/posts/${postId}`, { body }),
  deletePlanPost: (planId: number, postId: number) => req<PlanPost[]>('DELETE', `/plans/${planId}/posts/${postId}`),
  coachLibrary: () => req<CoachLibrary>('GET', '/coach-library'),
  coachLibraryItem: (id: number) => req<LibraryItem & { content: SharedDrill | SharedPlay | SharedPlan }>('GET', `/coach-library/items/${id}`),
  copyLibraryItem: (id: number, b: { sport_id?: number; team_id?: number; date?: string }) => req<{ kind: ShareKind; id: number }>('POST', `/coach-library/items/${id}/copy`, b),
  copyLibraryPack: (id: number, b: { sport_id?: number }) => req<{ drills: number; plays: number; plans_left: number }>('POST', `/coach-library/packs/${id}/copy`, b),
  /** System administrator only, from here to deleteLibraryPack. */
  libraryState: (kind: ShareKind, itemId: number) => req<{ id: number | null; published_at: string | null }>('GET', `/coach-library/state?kind=${kind}&item_id=${itemId}`),
  publishToLibrary: (kind: ShareKind, itemId: number) => req<CoachLibrary & { id: number }>('POST', '/coach-library/items', { kind, item_id: itemId }),
  describeLibraryItem: (id: number, description: string) => req<CoachLibrary>('PUT', `/coach-library/items/${id}`, { description }),
  unpublishLibraryItem: (id: number) => req<CoachLibrary>('DELETE', `/coach-library/items/${id}`),
  createLibraryPack: (b: PackFields) => req<CoachLibrary>('POST', '/coach-library/packs', b),
  updateLibraryPack: (id: number, b: Partial<PackFields>) => req<CoachLibrary>('PUT', `/coach-library/packs/${id}`, b),
  deleteLibraryPack: (id: number) => req<CoachLibrary>('DELETE', `/coach-library/packs/${id}`),
  communityLibrary: (kind: ShareKind, community: 'all' | number) => req<CommunityShare[]>('GET', `/community-library?kind=${kind}&community=${community}`),
  communityShare: (shareId: number) => req<CommunityShareDetail>('GET', `/community-library/${shareId}`),
  copyShare: (shareId: number, b: { sport_id?: number; team_id?: number; date?: string }) => req<{ kind: ShareKind; id: number }>('POST', `/community-library/${shareId}/copy`, b),
  adminSetSettings: (b: { registration_mode?: AdminSettings['registration_mode']; keyboard_access?: boolean }) => req<AdminSettings>('PUT', '/admin/settings', b),
  adminTestEmail: () => req<{ ok: true; to: string }>('POST', '/admin/test-email'),

  aiStatus: () => req<AiStatus>('GET', '/ai/status'),
  aiPrompt: (team_id: number) => req<{ prompt: string }>('GET', `/ai/prompt?team_id=${team_id}`),
  parseDraft: (reply: string) => req<ImportDraft>('POST', '/ai/parse-draft', { reply }),
  importPlan: (team_id: number, source: ImportSource) => req<ImportDraft>('POST', '/ai/import-plan', { team_id, source }),

  bootstrap: () => req<Bootstrap>('GET', '/bootstrap'),

  /** Opens a team shared with you, or goes back to your own teams with null. */
  setWorkspace: (teamId: number | null) => req<{ ok: true }>('POST', '/workspace', { team_id: teamId }),
  leaveSharedTeam: (teamId: number) => req<{ ok: true }>('DELETE', `/shared-teams/${teamId}`),
  staff: (teamId: number) => req<StaffMember[]>('GET', `/teams/${teamId}/staff`),
  addStaff: (teamId: number, b: { email: string; title: string; perms?: Partial<TeamPerms> }) => req<StaffMember[]>('POST', `/teams/${teamId}/staff`, b),
  updateStaff: (teamId: number, userId: number, b: { title?: string; perms?: Partial<TeamPerms> }) => req<StaffMember[]>('PUT', `/teams/${teamId}/staff/${userId}`, b),
  removeStaff: (teamId: number, userId: number) => req<StaffMember[]>('DELETE', `/teams/${teamId}/staff/${userId}`),

  createSport: (name: string) => req<Sport>('POST', '/sports', { name }),

  createTeam: (t: Partial<Team>) => req<Team>('POST', '/teams', t),
  updateTeam: (t: Team) => req<Team>('PUT', `/teams/${t.id}`, t),
  setTeamPositions: (teamId: number, positions: string[]) => req<Team>('PUT', `/teams/${teamId}/positions`, { positions }),
  setPositionPrefs: (teamId: number, prefs: Record<string, string[]>) => req<Team>('PUT', `/teams/${teamId}/positions`, { prefs }),
  deleteTeam: (id: number) => req('DELETE', `/teams/${id}`),

  setCalendar: (teamId: number, url: string) => req<{ count: number; team: Team }>('PUT', `/teams/${teamId}/calendar`, { url }),
  syncCalendar: (teamId: number) => req<{ count: number; team: Team }>('POST', `/teams/${teamId}/calendar/sync`),
  setEventKind: (teamId: number, eventId: number, kind: ScheduleEvent['kind']) => req<ScheduleEvent>('PUT', `/teams/${teamId}/events/${eventId}`, { kind }),
  events: (teamId: number, from: string) => req<ScheduleEvent[]>('GET', `/teams/${teamId}/events?from=${from}`),

  players: (teamId: number) => req<Player[]>('GET', `/teams/${teamId}/players`),
  createPlayer: (teamId: number, p: Partial<Player>) => req<Player>('POST', `/teams/${teamId}/players`, p),
  updatePlayer: (p: Player) => req<Player>('PUT', `/players/${p.id}`, p),
  deletePlayer: (id: number) => req('DELETE', `/players/${id}`),
  importPlayers: (teamId: number, players: Partial<Player>[], replace: boolean) =>
    req<{ imported: number }>('POST', `/teams/${teamId}/players/import`, { players, replace }),

  createTag: (t: Partial<Tag>) => req<Tag>('POST', '/tags', t),
  updateTag: (t: Tag) => req<Tag>('PUT', `/tags/${t.id}`, t),
  deleteTag: (id: number) => req('DELETE', `/tags/${id}`),

  uploadImage: (b: { data: string; width: number; height: number }) => req<{ id: number }>('POST', '/images', b),
  /** Sends a video file as it is, reporting progress from 0 to 1. */
  uploadVideo: (file: File, onProgress: (fraction: number) => void) =>
    new Promise<{ id: number }>((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open('POST', '/api/videos');
      xhr.setRequestHeader('Content-Type', file.type || 'application/octet-stream');
      xhr.upload.onprogress = (e) => e.lengthComputable && onProgress(e.loaded / e.total);
      xhr.onerror = () => reject(new Error('The upload was interrupted. Check your connection and try again.'));
      xhr.onload = () => {
        let data: { id?: number; error?: string } = {};
        try {
          data = JSON.parse(xhr.responseText);
        } catch {
          /* not JSON */
        }
        if (xhr.status === 401) window.dispatchEvent(new Event(SIGNED_OUT_EVENT));
        if (xhr.status >= 200 && xhr.status < 300 && data.id) resolve({ id: data.id });
        else reject(new Error(data.error || `The upload failed (${xhr.status}).`));
      };
      xhr.send(file);
    }),

  resources: () => req<Resource[]>('GET', '/resources'),
  addResource: (b: { kind: Resource['kind']; title: string; url?: string; file_id?: number }) => req<Resource[]>('POST', '/resources', b),
  renameResource: (id: number, title: string) => req<Resource[]>('PUT', `/resources/${id}`, { title }),
  deleteResource: (id: number) => req<Resource[]>('DELETE', `/resources/${id}`),

  plays: () => req<Play[]>('GET', '/plays'),
  play: (id: number) => req<Play>('GET', `/plays/${id}`),
  createPlay: (b: { sport_id: number; name?: string; category?: string; from_play_id?: number }) => req<Play>('POST', '/plays', b),
  updatePlay: (p: Play) => req<Play>('PUT', `/plays/${p.id}`, p),
  deletePlay: (id: number) => req('DELETE', `/plays/${id}`),

  drills: () => req<Drill[]>('GET', '/drills'),
  createDrill: (d: Partial<Drill>) => req<Drill>('POST', '/drills', d),
  updateDrill: (d: Drill) => req<Drill>('PUT', `/drills/${d.id}`, d),
  deleteDrill: (id: number) => req('DELETE', `/drills/${id}`),

  plans: (teamId: number, kind: PlanKind, templates = false) =>
    req<PlanSummary[]>('GET', `/plans?team_id=${teamId}&kind=${kind}&templates=${templates ? 1 : 0}`),
  plansFull: async (teamId: number, kind: PlanKind) =>
    (await req<Plan[]>('GET', `/plans?team_id=${teamId}&kind=${kind}&full=1`)).map(withKeys),
  plan: async (id: number) => withKeys(await req<Plan>('GET', `/plans/${id}`)),
  createPlan: (p: {
    team_id: number;
    kind?: PlanKind;
    title?: string;
    date?: string;
    start_time?: string;
    location?: string;
    is_template?: boolean;
    is_game?: boolean;
    from_plan_id?: number;
  }) => req<Plan>('POST', '/plans', p),
  savePlan: (p: Plan) =>
    req<Plan>('PUT', `/plans/${p.id}`, { ...p, items: p.items.map(({ key: _key, ...rest }: Item) => rest) }),
  deletePlan: (id: number) => req('DELETE', `/plans/${id}`),
};
