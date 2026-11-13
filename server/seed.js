// Starter data. Every new workspace gets Basketball with starter categories and drills, and
// adding a baseball or football team brings that sport's starter categories and drills with it.
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

// The basketball drills every new account starts with. They are written for any team: plain names,
// one line on how it is set up, then the points to coach. Changing these never touches drills that
// accounts already have, because they are only copied in when a workspace or a sport is first made.
const DRILL_DEFS = [
  {
    name: 'Team huddle',
    dur: 5,
    tags: ['Culture & mindset'],
    notes:
      '<p>Bring everyone in before the first drill.</p>' +
      ul("Say what today's practice is about, in one sentence", 'Name one thing the team is working to get better at', 'Remind players what good effort and being a good teammate look like'),
  },
  {
    name: 'Ball-handling warm-up',
    dur: 10,
    tags: ['Ball handling'],
    notes:
      '<p>Every player with a ball, baseline to half court and back. One move each trip.</p>' +
      ul('Right hand, then left hand', 'Crossover', 'Between the legs', 'Behind the back', 'Change of speed: walk, then explode') +
      '<p><strong>Coach:</strong> eyes up, ball below the waist.</p>',
  },
  {
    name: 'Layup lines',
    dur: 8,
    tags: ['Shooting'],
    notes:
      '<p>Two lines at half court: one shoots, one rebounds. Switch lines after each turn.</p>' +
      ul('Right side first, then left side', 'Jump off the inside foot, finish with the outside hand', 'Use the top corner of the square on the backboard', 'Rebounders catch the ball before it hits the floor'),
  },
  {
    name: 'Form shooting',
    dur: 10,
    tags: ['Shooting'],
    notes:
      '<p>One ball each, or share in pairs, about three feet from the basket.</p>' +
      ul('Shoot with one hand, elbow under the ball', 'Eyes on the rim', 'Hold the follow-through until the ball lands', 'Five makes from each of five spots, then take one step back'),
  },
  {
    name: 'Partner passing',
    dur: 8,
    tags: ['Passing'],
    notes:
      '<p>Pairs facing each other, about 12 feet apart, one ball per pair.</p>' +
      ul('Chest pass, bounce pass, overhead pass: ten of each', 'Step toward your partner on every pass', 'Receivers show a target with both hands', 'Add a second ball once the passes are crisp'),
  },
  {
    name: '1-on-1 moves and finishing',
    dur: 20,
    tags: ['1v1s', 'Shooting'],
    notes: '<p>Teach the moves without a defender first, then play them live. Split the team between two baskets.</p>',
    groups: [
      {
        name: 'Moves from the wing',
        notes_html: ul('Catch, rip through, drive right, then left', 'Jab step one way, drive the other', 'Shot fake, one dribble, pull-up jump shot', 'Finish every drive with the outside hand'),
        members: [],
      },
      {
        name: 'Live 1-on-1',
        notes_html: ul('Offense starts on the wing with the ball', 'Three dribbles at most', 'Defense keeps the ball out of the middle', 'Winner stays on, the other player goes to the end of the line'),
        members: [],
      },
    ],
  },
  {
    name: 'Shell drill',
    dur: 15,
    tags: ['Defense'],
    notes:
      '<p>Four on four in the half court. The offense only passes at first, then plays live.</p>' +
      ul('Three spots to know: on the ball, one pass away (deny), two passes away (help)', 'Move while the ball is in the air, on every pass', 'Close out with high hands and short steps', 'Talk: call "ball", "deny" or "help" out loud'),
  },
  {
    name: 'Box-out battle',
    dur: 8,
    tags: ['Rebounding'],
    notes:
      '<p>Pairs around the lane, one on offense and one on defense. A coach shoots.</p>' +
      ul('On the shot: find your player, make contact, turn, then go and get the ball', 'Defense scores a point for the rebound, offense scores two', 'Switch roles after three shots'),
  },
  {
    name: '3-on-2, 2-on-1 fast break',
    dur: 10,
    tags: ['Team offense', 'Passing'],
    notes:
      '<p>Three attack two defenders. Whoever shoots or loses the ball gets back on defense, and the two defenders attack them the other way.</p>' +
      ul('Ball in the middle, wide players run the lanes', 'Pass ahead to an open teammate instead of dribbling', 'Defenders: one stops the ball, one protects the basket'),
  },
  {
    name: '5-on-5 half court',
    dur: 20,
    tags: ['Team offense'],
    notes:
      '<p>Run your offense against a live defense. Play to three baskets, then switch offense and defense.</p>' +
      ul('Set solid screens and roll hard to the basket', 'Look for cutters before taking the shot', 'Stop play to fix one thing at a time, then let them play'),
  },
];

const BASEBALL = {
  tags: [
    ['Hitting', '#eb6834', 25],
    ['Throwing & catching', '#2a78d6', 15],
    ['Infield', '#1baf7a', 15],
    ['Outfield', '#008300', 10],
    ['Pitching & catching', '#6250d6', 10],
    ['Baserunning', '#eda100', 10],
    ['Team defense', '#e87ba4', 10],
    ['Culture & mindset', '#e34948', 5],
  ],
  drills: [
    { name: 'Dynamic warm-up & throwing progression', dur: 12, tags: ['Throwing & catching'], notes: ul('Jog, high knees, arm circles', 'Wrist flicks, one knee, then standing throws', 'Back up one step every five throws') },
    { name: 'Tee work', dur: 10, tags: ['Hitting'], notes: ul('Inside, middle and outside pitch locations', 'Balanced finish on every swing', '10 swings, then rotate') },
    { name: 'Soft toss', dur: 10, tags: ['Hitting'], notes: ul('Toss from the side, into a net', 'Load early, short path to the ball') },
    { name: 'Live batting practice', dur: 20, tags: ['Hitting'], groups: [{ name: 'Hitting' }, { name: 'On deck: tee' }, { name: 'Shagging' }], notes: ul('6 swings and a bunt, then rotate', 'Fielders play every ball live') },
    { name: 'Ground ball triangles', dur: 10, tags: ['Infield'], notes: ul('Feet wide, glove out front', 'Field, funnel, set the feet, throw', 'Forehand and backhand each round') },
    { name: 'Fly ball communication', dur: 10, tags: ['Outfield'], notes: ul('First step back, then find the ball', 'Call it three times, loudly', 'Crow hop into the throw') },
    { name: 'Cutoffs and relays', dur: 12, tags: ['Team defense'], notes: ul('Cutoff lines up with the base, hands up', 'Catch on the glove side and turn', 'Listen for "cut" or the base number') },
    { name: 'Bullpens', dur: 12, tags: ['Pitching & catching'], notes: ul('Fastball to both sides first', 'Catchers work on framing and blocking', 'Count the pitches') },
    { name: 'Baserunning circuit', dur: 10, tags: ['Baserunning'], notes: ul('Home to first: run through the bag', 'Leads and returns at first', 'Read the ball off the bat at second') },
    { name: 'Situations scrimmage', dur: 20, tags: ['Team defense'], notes: ul('Coach calls runners and outs before each pitch', 'Everyone says where the play is going') },
  ],
};
const FOOTBALL = {
  tags: [
    ['Individual positions', '#2a78d6', 20],
    ['Tackling', '#e34948', 10],
    ['Blocking', '#6250d6', 10],
    ['Team offense', '#eb6834', 20],
    ['Team defense', '#008300', 20],
    ['Special teams', '#eda100', 10],
    ['Conditioning', '#1baf7a', 5],
    ['Culture & mindset', '#e87ba4', 5],
  ],
  drills: [
    { name: 'Dynamic warm-up', dur: 10, tags: ['Conditioning'], notes: ul('High knees, butt kicks, carioca, backpedal', 'Form runs at half, then three quarter speed') },
    { name: 'Stance and starts', dur: 8, tags: ['Individual positions'], notes: ul('Check feet, hips and eyes in the stance', 'First step on the snap count, stay low') },
    { name: 'Form tackling', dur: 10, tags: ['Tackling'], notes: ul('Near foot, near shoulder, head across and up', 'Wrap, squeeze and run the feet', 'Start at walking speed') },
    { name: 'Angle tackling', dur: 10, tags: ['Tackling'], notes: ul('Take away the cutback', 'Track the near hip') },
    { name: 'Drive blocking', dur: 10, tags: ['Blocking'], notes: ul('Low pads, hands inside', 'Short, quick steps through the whistle') },
    { name: 'Position groups', dur: 15, tags: ['Individual positions'], groups: [{ name: 'Linemen' }, { name: 'Backs' }, { name: 'Receivers' }], notes: ul('Linemen: pass sets and pulls', 'Backs: handoffs and ball security', 'Receivers: releases and routes') },
    { name: 'Routes on air', dur: 10, tags: ['Team offense'], notes: ul('Full speed out of every break', 'Quarterbacks throw on rhythm') },
    { name: 'Team offense: script', dur: 15, tags: ['Team offense'], notes: ul('Huddle, break, line up, snap', 'Run the first ten plays of the script') },
    { name: 'Pursuit drill', dur: 8, tags: ['Team defense'], notes: ul('Everyone takes an angle to the ball', 'Nobody follows the same colored jersey') },
    { name: 'Team defense: recognition', dur: 15, tags: ['Team defense'], notes: ul('Call the strength and the coverage', 'Align to each formation before the snap') },
    { name: 'Special teams period', dur: 10, tags: ['Special teams'], notes: ul('Kickoff lanes', 'Punt protection and coverage') },
  ],
};
const VOLLEYBALL = {
  tags: [
    ['Serving', '#2a78d6', 15],
    ['Passing', '#eda100', 20],
    ['Setting', '#6250d6', 10],
    ['Attacking', '#eb6834', 15],
    ['Blocking', '#e34948', 5],
    ['Defense', '#008300', 15],
    ['Team play', '#1baf7a', 15],
    ['Culture & mindset', '#e87ba4', 5],
  ],
  drills: [
    { name: 'Dynamic warm-up', dur: 8, tags: ['Culture & mindset'], notes: ul('Jog, shuffle and carioca along the net', 'Arm circles and band work for shoulders', 'Approach jumps, three each side') },
    { name: 'Partner pepper', dur: 8, tags: ['Passing', 'Setting'], notes: ul('Pass, set, controlled hit, dig', 'Keep it off the floor for ten in a row', 'Switch partners at the whistle') },
    { name: 'Serving progression', dur: 10, tags: ['Serving'], notes: ul('Toss in front of the hitting shoulder', 'Start at the 3 m line, step back after five in', 'Finish with ten from the end line') },
    { name: 'Target serving', dur: 10, tags: ['Serving'], notes: ul('Call the zone before every serve', 'Zones 1, 5 and 6 first, then the seams', 'Two misses in a row: reset the routine') },
    { name: 'Serve receive triangles', dur: 12, tags: ['Passing'], notes: ul('Three passers, one target at the net', 'Platform out early, angle it to the target', 'Call "mine" before the ball crosses the net', 'Rotate after five good passes') },
    { name: 'Butterfly passing', dur: 10, tags: ['Passing'], notes: ul('Serve, pass, catch, then follow your ball', 'Keep both lines moving', 'Count passes that reach the target') },
    { name: 'Setter footwork and targets', dur: 10, tags: ['Setting'], notes: ul('Right foot forward, square to the left antenna', 'Sets to outside, middle and back', 'Setters call the set before the pass arrives') },
    { name: 'Hitting lines', dur: 12, tags: ['Attacking'], groups: [{ name: 'Outside' }, { name: 'Middle' }, { name: 'Right side' }], notes: ul('Left, right, left approach, big last two steps', 'Reach high and snap the wrist', 'Shag your own ball and switch lines') },
    { name: 'Blocking footwork', dur: 8, tags: ['Blocking'], notes: ul('Shuffle for short moves, crossover for long ones', 'Hands over the net, press and seal', 'Land on two feet') },
    { name: 'Dig and cover', dur: 10, tags: ['Defense'], notes: ul('Stay low and still as the hitter contacts', 'Dig high to the middle of the court', 'Everyone covers the hitter after the set') },
    { name: 'Wash drill: serve receive to attack', dur: 15, tags: ['Team play'], notes: ul('Six against six, receiving side must win the rally and the free ball that follows', 'Win both to rotate', 'Talk before every serve: who has the seams') },
    { name: 'Six on six scrimmage', dur: 15, tags: ['Team play'], notes: ul('Play it out with rally scoring', 'Stop to fix one thing at a time', 'Rotate the bench in every five points') },
  ],
};
/** Sports that come with starter material. Anything else starts empty. */
const STARTERS = { basketball: { tags: TAG_DEFS, drills: DRILL_DEFS }, baseball: BASEBALL, softball: BASEBALL, football: FOOTBALL, volleyball: VOLLEYBALL };

/** Adds a sport to a workspace, with its starter categories and drills when it has them. Call inside a transaction. */
export function seedSport(ownerId, name) {
  const starter = STARTERS[String(name).trim().toLowerCase()] || { tags: [], drills: [] };
  const sport = lastId(run('INSERT INTO sports (owner_id, name) VALUES (?, ?)', ownerId, String(name).trim()));
  const tag = {};
  for (const [name, color, target] of starter.tags) {
    tag[name] = lastId(
      run('INSERT INTO tags (owner_id, sport_id, name, color, target_pct) VALUES (?,?,?,?,?)', ownerId, sport, name, color, target),
    );
  }
  const drill = {};
  for (const d of starter.drills) {
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

/** Basketball, the sport every workspace starts with. */
export const seedStarter = (ownerId) => seedSport(ownerId, 'Basketball');

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

  const W = { drill: 'Team huddle' };
  const D = { drill: 'Ball-handling warm-up' };
  const K = { drill: '1-on-1 moves and finishing' };
  const loc = 'Clay Elementary';
  addPlan(daysAgo(21), 'Practice', loc, [W, D, { drill: 'Form shooting' }, brk, { drill: 'Partner passing' }, K, { drill: '5-on-5 half court' }]);
  addPlan(daysAgo(19), 'Practice', loc, [W, D, K, brk, { drill: 'Form shooting', dur: 15 }, { drill: '5-on-5 half court', dur: 25 }]);
  addPlan(daysAgo(14), 'Practice', loc, [W, { ...D, dur: 15 }, { drill: 'Shell drill' }, brk, { drill: 'Form shooting' }, { drill: '5-on-5 half court' }]);
  addPlan(daysAgo(12), 'Practice', loc, [W, D, { drill: 'Form shooting', dur: 15 }, K, brk, { drill: '5-on-5 half court' }]);
  addPlan(daysAgo(7), 'Practice', loc, [W, D, { ...K, dur: 25 }, brk, { drill: 'Form shooting' }, { drill: '5-on-5 half court', dur: 25 }]);
  addPlan(daysAgo(5), 'Practice', loc, [W, D, { drill: 'Form shooting', dur: 20 }, brk, K, { drill: '5-on-5 half court' }]);
  addPlan(daysAgo(0), 'Practice', loc, [
    W,
    D,
    { kind: 'break', title: 'Water break', dur: 10 },
    {
      ...K,
      coach: '<p>Watch footwork on the jab. Stop play and reset if they travel.</p>',
      playerNotes: [{ player_id: pid.Kam, note: 'Left hand finishes only today.' }],
    },
    { drill: '5-on-5 half court', groups: squads, coach: '<p>Rotate groups every 5 minutes.</p>' },
  ]);

  addPlan('', 'Standard Tuesday', loc, [W, D, brk, { drill: 'Form shooting' }, { drill: '5-on-5 half court' }], { template: true });

  addPlan(
    daysAgo(0),
    'Weekly homework',
    '',
    [
      { drill: 'Ball-handling warm-up', title: 'Stationary dribbling', reps: '3 rounds, 30 seconds each move' },
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
