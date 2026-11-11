import type { Drill, ImportDraft, Item, Plan, PlanKind, PlanSummary, Play, Player, Resource, ScheduleEvent, Sport, Tag, Team } from './types';

/** Fired when the server says the session is gone, so the app can show the sign-in screen. */
export const SIGNED_OUT_EVENT = 'practiceplan:signed-out';

async function req<T>(method: string, url: string, body?: unknown): Promise<T> {
  const res = await fetch('/api' + url, {
    method,
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
  teams: Team[];
  tags: Tag[];
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
  prefs: { heat_color?: string };
}
export interface AuthStatus {
  /** True on a fresh install with no accounts yet. */
  setup_needed: boolean;
  registration_open: boolean;
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
}
export interface SystemState {
  default_cap_mb: number;
  max_cap_mb: number;
  total_bytes: number;
  users: SystemUser[];
}
export interface StorageSpace {
  used_bytes: number;
  files: number;
  cap_bytes: number;
  left_bytes: number;
}
export interface AdminSettings {
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
  register: (b: { name: string; email: string; password: string }) => req('POST', '/auth/register', b),
  confirm: (token: string) => req('POST', '/auth/confirm', { token }),
  savePrefs: (prefs: { heat_color: string | null }) => req<{ user: User }>('PUT', '/auth/prefs', prefs),
  changePassword: (current: string, next: string) => req<{ user: User }>('POST', '/auth/password', { current, next }),

  adminUsers: () => req<AdminUser[]>('GET', '/admin/users'),
  adminCreateUser: (b: { name: string; email: string; password: string; can_import: boolean }) => req<AdminUser>('POST', '/admin/users', b),
  adminUpdateUser: (id: number, b: { can_import?: boolean; status?: 'active' | 'disabled'; password?: string }) =>
    req<AdminUser>('PUT', `/admin/users/${id}`, b),
  adminSettings: () => req<AdminSettings>('GET', '/admin/settings'),
  system: () => req<SystemState>('GET', '/system'),
  systemSetDefaults: (b: { default_cap_mb: number }) => req<SystemState>('PUT', '/system/settings', b),
  systemUpdateUser: (id: number, b: { upload_cap_mb?: number | null; is_admin?: boolean }) => req<SystemState>('PUT', `/system/users/${id}`, b),
  storage: () => req<StorageSpace>('GET', '/storage'),
  adminSetSettings: (b: { registration_enabled: boolean }) => req<AdminSettings>('PUT', '/admin/settings', b),

  aiStatus: () => req<AiStatus>('GET', '/ai/status'),
  aiPrompt: (team_id: number) => req<{ prompt: string }>('GET', `/ai/prompt?team_id=${team_id}`),
  parseDraft: (reply: string) => req<ImportDraft>('POST', '/ai/parse-draft', { reply }),
  importPlan: (team_id: number, source: ImportSource) => req<ImportDraft>('POST', '/ai/import-plan', { team_id, source }),

  bootstrap: () => req<Bootstrap>('GET', '/bootstrap'),

  createSport: (name: string) => req<Sport>('POST', '/sports', { name }),

  createTeam: (t: Partial<Team>) => req<Team>('POST', '/teams', t),
  updateTeam: (t: Team) => req<Team>('PUT', `/teams/${t.id}`, t),
  deleteTeam: (id: number) => req('DELETE', `/teams/${id}`),

  setCalendar: (teamId: number, url: string) => req<{ count: number; team: Team }>('PUT', `/teams/${teamId}/calendar`, { url }),
  syncCalendar: (teamId: number) => req<{ count: number; team: Team }>('POST', `/teams/${teamId}/calendar/sync`),
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
