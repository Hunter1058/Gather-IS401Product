// Supabase-shaped fixture for HTTP/controller tests. This is not a PostgreSQL
// permission or concurrency test; the real SQL rehearsal is separate.
export const A = '11111111-1111-4111-8111-111111111111';
export const B = '22222222-2222-4222-8222-222222222222';
export const C = '33333333-3333-4333-8333-333333333333';
export function friendDatabase() {
  const users = [A, B, C].map((id, i) => ({ user_id: id, display_name: ['Alex', 'Blair <friend>', 'Casey'][i], username: null }));
  const attempts = [], friendships = new Set(), calls = [], errors = new Map();
  let next = 9007199254740993n;
  const pair = (a, b) => [a, b].sort().join(':');
  const failure = code => ({ data: null, error: { code } });
  const success = data => ({ data: structuredClone(data), error: null });
  function status(actor, other) {
    if (friendships.has(pair(actor, other))) return { relationship: 'friends', request_id: null };
    const row = attempts.find(r => r.Status === 'pending' && pair(r.RequesterUserID, r.RecipientUserID) === pair(actor, other));
    return row ? { relationship: row.RequesterUserID === actor ? 'outgoing_pending' : 'incoming_pending', request_id: row.FriendRequestID }
      : { relationship: 'none', request_id: null };
  }
  async function rpc(actor, name, args) {
    calls.push({ actor, name, args: structuredClone(args) });
    if (errors.has(name)) return failure(errors.get(name));
    if (!actor) return failure('42501');
    if (name === 'get_friend_people') return success(users.filter(user => user.user_id !== actor &&
      (!args.p_after || user.user_id > args.p_after) && (!args.p_person_id || user.user_id === args.p_person_id))
      .slice(0, args.p_limit).map(user => ({ ...user, ...status(actor, user.user_id) })));
    if (name === 'send_friend_request') {
      const other = args.p_recipient_user_id;
      if (!users.some(u => u.user_id === other)) return failure('23503');
      const current = status(actor, other);
      if (['friends', 'incoming_pending'].includes(current.relationship)) return failure('22023');
      let row = attempts.find(r => r.FriendRequestID === current.request_id);
      if (!row) { row = { FriendRequestID: String(next++), RequesterUserID: actor, RecipientUserID: other, Status: 'pending' }; attempts.push(row); }
      return success(row);
    }
    if (name === 'cancel_friend_request' || name === 'respond_to_friend_request') {
      const row = attempts.find(r => r.FriendRequestID === args.p_request_id);
      const ownerField = name === 'cancel_friend_request' ? 'RequesterUserID' : 'RecipientUserID';
      if (!row || row[ownerField] !== actor) return failure('42501');
      const wanted = name === 'cancel_friend_request' ? 'cancelled' : args.p_accept ? 'accepted' : 'declined';
      if (row.Status !== 'pending' && row.Status !== wanted) return failure('22023');
      if (row.Status === 'pending') {
        row.Status = wanted;
        if (wanted === 'accepted') friendships.add(pair(row.RequesterUserID, row.RecipientUserID));
      }
      return success(row);
    }
    if (name === 'remove_friend') return success(friendships.delete(pair(actor, args.p_other_user_id)));
    return failure('PGRST202');
  }
  return { users, attempts, friendships, calls, errors, rpc, status };
}
