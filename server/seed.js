// Starter data. Every new workspace gets Basketball with starter categories and drills.
// A brand new install also gets a demo team so the dashboard has something to show.
import { get, run, tx } from './db.js';

const ul = (...items) => '<ul>' + items.map((i) => `<li><p>${i}</p></li>`).join('') + '</ul>';
const iso = (d) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const daysAgo = (n) => {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return iso(d);
};
const lastId = (r) => Number(r.lastInsertRowid);

const TAG_DEFS = [
  ['Ball handling', '#2a78d6', 15],
  ['Shooting', '#eb6834', 20],
  ['1v1s', '#1baf7a', 15],
  ['Passing', '#eda100', 10],
  ['Team offense', '#e87ba4', 15],
  ['Defense', '#008300', 15],
  ['Rebounding', '#6250d6', 5],
  ['Culture & mindset', '#e34948', 5],
];

const DRILL_DEFS = [
  {
    name: 'Welcome & expectations',
    dur: 5,
    tags: ['Culture & mindset'],
    notes:
      '<ul><li><p><strong><em>"You got this" + five. Look for the signs. EFFORT.</em></strong></p></li>' +
      '<li><p><strong>Our mantras (yesterday, too)</strong></p><ul><li><p>Were you coachable?</p></li>' +
      '<li><p>Were you a great teammate?</p></li><li><p>Did you let your mistakes define you?</p></li>' +
      '<li><p>Did you give it everything you got?</p></li></ul></li></ul>',
  },
  {
    name: 'Dribble warm up',
    dur: 10,
    tags: ['Ball handling'],
    notes: ul(
      'Right/Left',
      'Right V / left V',
      'Right V, cross / left V, cross',
      'Skip pocket right, cross / skip pocket left, cross',
      'Same, between the legs instead of cross',
    ),
  },
  {
    name: 'Key Series + 10m Blast 1v1s',
    dur: 20,
    tags: ['1v1s', 'Shooting'],
    notes: '<p><strong>BLAST RULE: If defense gives up middle, automatic loss</strong></p>',
    groups: [
      {
        name: '',
        notes_html: ul(
          'Take, straight right / left',
          'Rip, L, R, off foot layup',
          'Jab opposite, straight take opposite',
          'Flash to elbow, catch and shoot',
        ),
        members: [],
      },
      {
        name: '',
        notes_html: ul(
          'Flash to elbow, pump, single dribble jumper',
          'Jab, single dribble, between legs, single dribble, shoot',
          '<strong>Skip step push out &rarr; Floater</strong>',
          'Shoulder into coach; R&rarr;L euro',
        ),
        members: [],
      },
    ],
  },
  { name: 'RAM 5v5', dur: 20, tags: ['Team offense'], notes: ul('Quality ball screens &amp; rolls, we hit cutters') },
  {
    name: 'Form shooting',
    dur: 10,
    tags: ['Shooting'],
    notes: ul('One hand, 3 feet out', 'Hold the follow through', '5 makes per spot, 5 spots'),
  },
  {
    name: 'Shell drill',
    dur: 15,
    tags: ['Defense'],
    notes: ul('Ball, deny, help positions', 'Jump to the ball on every pass', 'Close out with high hands'),
  },
  { name: 'Partner passing', dur: 8, tags: ['Passing'], notes: ul('Chest, bounce, overhead', 'Step to the pass, show a target') },
  { name: 'Box out battle', dur: 8, tags: ['Rebounding'], notes: ul('Hit, turn, pursue', 'Loser does 5 push ups') },
];

/** Basketball with starter categories and drills for one workspace. Call inside a transaction. */
export function seedStarter(ownerId) {
  const sport = lastId(run("INSERT INTO sports (owner_id, name) VALUES (?, 'Basketball')", ownerId));
  const tag = {};
  for (const [name, color, target] of TAG_DEFS) {
    tag[name] = lastId(
      run('INSERT INTO tags (owner_id, sport_id, name, color, target_pct) VALUES (?,?,?,?,?)', ownerId, sport, name, color, target),
    );
  }
  const drill = {};
  for (const d of DRILL_DEFS) {
    const id = lastId(
      run(
        'INSERT INTO drills (owner_id, sport_id, name, duration_min, notes_html, callout, groups_json) VALUES (?,?,?,?,?,?,?)',
        ownerId, sport, d.name, d.dur, d.notes || '', d.callout || '', JSON.stringify(d.groups || []),
      ),
    );
    drill[d.name] = { ...d, id };
    for (const t of d.tags) run('INSERT INTO drill_tags (drill_id, tag_id) VALUES (?,?)', id, tag[t]);
  }
  return { sport, tag, drill };
}

/** A new, empty workspace with the starter data. Call inside a transaction. Returns its id. */
export function createWorkspace(name) {
  const ownerId = lastId(run('INSERT INTO owners (name) VALUES (?)', name));
  seedStarter(ownerId);
  return ownerId;
}

function seedDemoTeam(ownerId, { sport, tag, drill }) {
  const team = lastId(
    run(
      'INSERT INTO teams (owner_id, sport_id, name, season, notes) VALUES (?,?,?,?,?)',
      ownerId, sport, 'Demo Team', '2026-27', 'Sample data. Delete this team whenever you like.',
    ),
  );
  const names = ['Asher', 'Nigel', 'Declan', 'Mason', 'Kam', 'Theo', 'Jonah', 'Eli', 'Micah', 'Owen'];
  const pos = ['PG', 'SG', 'SF', 'PF', 'C'];
  const pid = {};
  names.forEach((n, i) => {
    pid[n] = lastId(
      run(
        'INSERT INTO players (owner_id, team_id, name, number, position, grade) VALUES (?,?,?,?,?,?)',
        ownerId, team, n, String(i + 2), pos[i % 5], '5',
      ),
    );
  });

  const addPlan = (date, title, location, items, opts = {}) => {
    const plan = lastId(
      run(
        'INSERT INTO plans (owner_id, team_id, kind, title, date, start_time, location, is_template) VALUES (?,?,?,?,?,?,?,?)',
        ownerId, team, opts.kind || 'practice', title, date, '17:30', location, opts.template ? 1 : 0,
      ),
    );
    items.forEach((it, i) => {
      const d = it.drill ? drill[it.drill] : null;
      const id = lastId(
        run(
          `INSERT INTO plan_items (plan_id, position, kind, title, duration_min, notes_html, coach_notes_html,
             callout, reps, groups_json, player_notes_json, drill_id) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
          plan, i, it.kind || 'item', it.title || d?.name || 'Break', it.dur ?? d?.dur ?? 5,
          it.notes ?? d?.notes ?? '', it.coach || '', it.callout ?? d?.callout ?? '', it.reps || '',
          JSON.stringify(it.groups ?? d?.groups ?? []), JSON.stringify(it.playerNotes || []), d?.id ?? null,
        ),
      );
      for (const t of it.tags ?? d?.tags ?? []) run('INSERT INTO plan_item_tags (item_id, tag_id) VALUES (?,?)', id, tag[t]);
    });
  };

  const brk = { kind: 'break', title: 'Water break', dur: 5 };
  const squads = [
    ['Asher', 'Nigel', 'Declan', 'Theo', 'Eli'],
    ['Nigel', 'Mason', 'Kam', 'Jonah', 'Owen'],
    ['Asher', 'Declan', 'Kam', 'Micah', 'Theo'],
    ['Mason', 'Asher', 'Declan', 'Eli', 'Owen'],
  ].map((g, i) => ({
    name: `Group ${i + 1}`,
    notes_html: '',
    members: g.map((n, j) => ({ player_id: pid[n], role: pos[j] })),
  }));

  const W = { drill: 'Welcome & expectations' };
  const D = { drill: 'Dribble warm up' };
  const K = { drill: 'Key Series + 10m Blast 1v1s' };
  const loc = 'Clay Elementary';
  addPlan(daysAgo(21), 'Practice', loc, [W, D, { drill: 'Form shooting' }, brk, { drill: 'Partner passing' }, K, { drill: 'RAM 5v5' }]);
  addPlan(daysAgo(19), 'Practice', loc, [W, D, K, brk, { drill: 'Form shooting', dur: 15 }, { drill: 'RAM 5v5', dur: 25 }]);
  addPlan(daysAgo(14), 'Practice', loc, [W, { ...D, dur: 15 }, { drill: 'Shell drill' }, brk, { drill: 'Form shooting' }, { drill: 'RAM 5v5' }]);
  addPlan(daysAgo(12), 'Practice', loc, [W, D, { drill: 'Form shooting', dur: 15 }, K, brk, { drill: 'RAM 5v5' }]);
  addPlan(daysAgo(7), 'Practice', loc, [W, D, { ...K, dur: 25 }, brk, { drill: 'Form shooting' }, { drill: 'RAM 5v5', dur: 25 }]);
  addPlan(daysAgo(5), 'Practice', loc, [W, D, { drill: 'Form shooting', dur: 20 }, brk, K, { drill: 'RAM 5v5' }]);
  addPlan(daysAgo(0), 'Practice', loc, [
    W,
    D,
    { kind: 'break', title: 'Water break', dur: 10 },
    {
      ...K,
      title: 'Key Series + 10m Blast 1v1s (1 groups)',
      coach: '<p>Watch footwork on the jab. Stop play and reset if they travel.</p>',
      playerNotes: [{ player_id: pid.Kam, note: 'Left hand finishes only today.' }],
    },
    { drill: 'RAM 5v5', groups: squads, coach: '<p>Rotate groups every 5 minutes.</p>' },
  ]);

  addPlan('', 'Standard Tuesday', loc, [W, D, brk, { drill: 'Form shooting' }, { drill: 'RAM 5v5' }], { template: true });

  addPlan(
    daysAgo(0),
    'Weekly homework',
    '',
    [
      { drill: 'Dribble warm up', title: 'Stationary dribbling', reps: '3 rounds, 30 seconds each move' },
      { drill: 'Form shooting', reps: '50 makes', notes: ul('One hand, close to the hoop or a wall', 'Hold the follow through') },
      { title: 'Wall passing', dur: 5, tags: ['Passing'], reps: '3 x 25', notes: ul('Chest pass, then left and right hand push pass') },
    ],
    { kind: 'homework' },
  );
}

/** First run of a brand new install: the first workspace, with the demo team. */
export function seedIfEmpty() {
  if (get('SELECT id FROM owners LIMIT 1')) return;
  tx(() => {
    run("INSERT INTO owners (id, name) VALUES (1, 'First workspace')");
    seedDemoTeam(1, seedStarter(1));
  });
}
