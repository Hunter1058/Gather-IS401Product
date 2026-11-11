import test from 'node:test';
import assert from 'node:assert/strict';
import { planInput, profileId, readPlans, writePlan } from '../lib/event-plans.js';

import { database, USER_A, USER_B } from './helpers/database.js';

test('validate positive bigint IDs without numeric coercion and strictly boolean payloads', () => {
  assert.equal(planInput('9223372036854775807', { going: true }, 'going'), true);
  for (const id of ['0', '-1', '1.2', '1junk', '01', '9223372036854775808'])
    assert.throws(() => planInput(id, { going: true }, 'going'), { status: 400 });
  for (const input of [null, [], {}, { going: 'true' }, { going: true, UserID: 8 }])
    assert.throws(() => planInput('1', input, 'going'), { status: 400 });
});

test('resolve the verified Auth UUID to its existing UUID profile', async () => {
  const db = database();
  assert.equal(await profileId(db.client, USER_A), USER_A);
  await assert.rejects(profileId(db.client, '33333333-3333-4333-8333-333333333333'), { status: 503 });
});

test('bookmark retries are idempotent and removal affects only this owner/event', async () => {
  const db = database();
  await writePlan(db.client, USER_A, '1', 'bookmark', true);
  await writePlan(db.client, USER_A, '1', 'bookmark', true);
  await writePlan(db.client, USER_A, '2', 'bookmark', true);
  await writePlan(db.client, USER_B, '1', 'bookmark', true);
  assert.equal(db.rows.Bookmark.length, 3);
  await writePlan(db.client, USER_A, '1', 'bookmark', false);
  assert.deepEqual((await readPlans(db.client, USER_A)).saved, ['2']);
  assert.deepEqual((await readPlans(db.client, USER_B)).saved, ['1']);
});

test('RSVP cancellation preserves the row as false and removes it from going state', async () => {
  const db = database();
  await writePlan(db.client, USER_A, '1', 'rsvp', true);
  const result = await writePlan(db.client, USER_A, '1', 'rsvp', false);
  assert.equal(result.going, false);
  assert.equal(db.rows.RSVP.length, 1);
  assert.equal(db.rows.RSVP[0].RSVPGoing, false);
  assert.deepEqual((await readPlans(db.client, USER_A)).rsvp, []);
});

test('different event writes can overlap without replacing each other', async () => {
  const db = database();
  await Promise.all([
    writePlan(db.client, USER_A, '1', 'bookmark', true),
    writePlan(db.client, USER_A, '2', 'bookmark', true),
    writePlan(db.client, USER_A, '1', 'rsvp', true),
  ]);
  const state = await readPlans(db.client, USER_A);
  assert.deepEqual(state.saved.sort(), ['1', '2']);
  assert.deepEqual(state.rsvp, ['1']);
});

test('missing events are rejected before writing plans', async () => {
  const db = database();
  await assert.rejects(writePlan(db.client, USER_A, '99', 'rsvp', true), { status: 404 });
  assert.equal(db.rows.RSVP.length, 0);
});

test('read failures are surfaced instead of looking like empty preferences', async () => {
  const db = database();
  db.errors.set('Bookmark', { code: '42501', message: 'denied' });
  await assert.rejects(readPlans(db.client, USER_A), { code: '42501' });
});

test('write failures are propagated and schema errors explain the migration', async () => {
  const db = database();
  db.errors.set('RSVP', { code: '42501', message: 'denied' });
  await assert.rejects(writePlan(db.client, USER_A, '1', 'rsvp', true), { code: '42501' });
  db.errors.set('User', { code: '42703', message: 'missing UserID' });
  await assert.rejects(profileId(db.client, USER_A), { status: 503 });
});

test('friend attendance uses the caller-scoped RPC and preserves event IDs', async () => {
  const db = database();
  db.client.rpc = async (...args) => {
    assert.deepEqual(args, ['gather_friends_going']);
    return { data: [{ EventID: '9223372036854775807' }], error: null };
  };
  const state = await readPlans(db.client, USER_A);
  assert.deepEqual(state.friendsGoing, ['9223372036854775807']);
  assert.equal(state.friendsGoingError, '');
});

test('attendance query failures keep personal plans available with an explicit error', async () => {
  const db = database();
  await writePlan(db.client, USER_A, '1', 'bookmark', true);
  db.client.rpc = async () => ({ data: null, error: { code: 'PGRST202' } });
  const state = await readPlans(db.client, USER_A);
  assert.deepEqual(state.saved, ['1']);
  assert.deepEqual(state.friendsGoing, []);
  assert.match(state.friendsGoingError, /could not be loaded/);
});
