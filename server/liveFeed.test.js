// Run with "npm test".
import test from 'node:test';
import assert from 'node:assert/strict';
import { livePlays } from './liveFeed.js';

const names = { 4: 'Ava', 7: 'Bea' };
const opts = { nameOf: (id) => names[id] || 'A player', oppName: 'Tigers', oppPlayers: [{ id: 1, label: '23' }] };
const e = (id, side, player, type, extra = {}) => ({ id, side, player, type, period: 1, clock: null, at: 0, ...extra });

test('each play carries who did it and the score after it', () => {
  const out = livePlays([e('a', 'us', 4, 'm3'), e('b', 'them', null, 'm2'), e('c', 'us', 7, 'x2'), e('d', 'them', 1, 'm1')], opts);
  assert.deepEqual(out.map((p) => [p.who, p.type, p.us, p.them]), [['Ava', 'm3', 3, 0], ['Tigers', 'm2', 3, 2], ['Bea', 'x2', 3, 2], ['Tigers #23', 'm1', 3, 3]]);
});

test('a play not given to a player has no name, and an unknown player gets what the page allows', () => {
  const out = livePlays([e('a', 'us', null, 'm2'), e('b', 'us', 99, 'reb', { for: null })], opts);
  assert.equal(out[0].who, '');
  assert.equal(out[1].who, 'A player');
});

test('a rebound off the team\'s own miss is offensive; one put in by itself is not', () => {
  const out = livePlays([e('a', 'us', 4, 'x2'), e('b', 'us', 7, 'reb', { for: 'a' }), e('c', 'us', 7, 'reb', { for: null }), e('d', 'us', 4, 'x3'), e('f', 'us', 7, 'reb'), e('g', 'them', null, 'reb', { for: 'd' })], opts);
  assert.deepEqual(out.filter((p) => p.type === 'reb').map((p) => p.off), [true, false, true, false]);
});

test('an assist names the shot it set up, when that shot is still there', () => {
  const out = livePlays([e('a', 'us', 4, 'm2'), e('b', 'us', 7, 'ast', { for: 'a' }), e('c', 'us', 7, 'ast', { for: null }), e('d', 'us', 7, 'ast', { for: 'gone' })], opts);
  assert.deepEqual(out.map((p) => p.shot), [undefined, 'a', undefined, undefined]);
});

test('a forced turnover says who forced it, from the other side; a shooting foul says how many throws', () => {
  const out = livePlays([e('a', 'them', null, 'to', { forced: true, by: 7 }), e('b', 'us', 4, 'to', { forced: true, by: 1 }), e('c', 'us', 4, 'to', { forced: false }), e('d', 'us', 7, 'pf', { fts: 2 })], opts);
  assert.deepEqual([out[0].forced, out[0].by], [true, 'Bea']);
  assert.equal(out[1].by, 'Tigers #23');
  assert.equal(out[2].forced, undefined);
  assert.equal(out[3].fts, 2);
});

test('where a shot was taken, and the way to it, come through', () => {
  const out = livePlays([e('a', 'us', 4, 'm2', { x: 0.5, y: 0.2, path: [[0.8, 0.7], [0.5, 0.2]] }), e('b', 'us', 4, 'x2')], opts);
  assert.deepEqual([out[0].x, out[0].y, out[0].path.length], [0.5, 0.2, 2]);
  assert.equal('x' in out[1], false);
});
