// Supabase-shaped fixture for HTTP/controller tests. This is not a PostgreSQL
// permission or concurrency test; the real SQL rehearsal is separate.
export const A = '11111111-1111-4111-8111-111111111111';
export const B = '22222222-2222-4222-8222-222222222222';
export const C = '33333333-3333-4333-8333-333333333333';
// Search fixture mirrors the contract for UI/HTTP tests, not SQL execution.
function editDistance(a, b) {
  let row = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const next = [i];
    for (let j = 1; j <= b.length; j++) next[j] = Math.min(next[j-1]+1, row[j]+1, row[j-1]+(a[i-1] === b[j-1] ? 0 : 1));
    row = next;
  }
  return row[b.length];
}
function nameMatches(query, name, fuzzy) {
  if (!name.trim() || query.length > 80) return false;
  return query.split(/\s+/).every(q => name.split(/\s+/).some(word => word.includes(q) ||
    (fuzzy && q.length >= 4 && editDistance(q, word) <= (q.length >= 8 ? 2 : 1))));
}
function rankPerson(user, input) {
  const query = input.toLowerCase().trim().replace(/\s+/g, ' ');
  if (!query) return 0;
  if (query === '@') return null;
  const handleOnly = query.startsWith('@'), emailOnly = !handleOnly && query.includes('@');
  const handleQuery = handleOnly ? query.slice(1) : query;
  const handle = (user.username || '').toLowerCase();
  const name = (user.first_name != null || user.last_name != null
    ? [user.first_name, user.last_name].filter(Boolean).join(' ') : user.display_name || '').toLowerCase().trim();
  if (!emailOnly && handleQuery && handle === handleQuery) return 1;
  if (!emailOnly && handleQuery && handle.startsWith(handleQuery)) return 2;
  if (!emailOnly && handleQuery && handle.includes(handleQuery)) return 3;
  if (!user.is_private && !handleOnly && !emailOnly && name === query) return 4;
  if (!user.is_private && !handleOnly && !emailOnly && nameMatches(query, name, false)) return 5;
  if (!user.is_private && !handleOnly && !emailOnly && nameMatches(query, name, true)) return 6;
  if (!user.is_private && (user.email || '').toLowerCase().includes(query)) return 7;
  return null;
}
export function friendDatabase() {
  const users = [A, B, C].map((id, i) => ({ user_id: id, display_name: ['Alex', 'Blair <friend>', 'Casey'][i], username: null, is_private: false }));
  const rsvps = new Map(), interests = new Map(), eventRecords = new Map(), categoryRecords = new Map();
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
    if (name === 'get_friend_connections') {
      const target=users.find(u=>u.user_id===args.p_person_id);
      if (!target) return failure('23503');
      if (target.is_private) return success([]);
      let rows;
      if (args.p_kind==='friends') rows=users.filter(u=>u.user_id!==actor && u.user_id!==target.user_id && !u.is_private &&
        friendships.has(pair(actor,u.user_id)) && friendships.has(pair(target.user_id,u.user_id)))
        .sort((a,b)=>a.user_id.localeCompare(b.user_id))
        .map(u=>({item_id:u.user_id,label:u.display_name,username:u.username}));
      else if (args.p_kind==='events') rows=[...(rsvps.get(actor)||[])].filter(id=>rsvps.get(target.user_id)?.has(id))
        .map(id=>({item_id:id,label:eventRecords.get(id)?.name || 'Event '+id,event_date:eventRecords.get(id)?.date,
          event_location:eventRecords.get(id)?.location}));
      else rows=[...(interests.get(actor)||[])].filter(id=>interests.get(target.user_id)?.has(id))
        .map(id=>({item_id:id,label:categoryRecords.get(id) || 'Interest '+id}));
      if (args.p_kind!=='friends') rows.sort((a,b)=>BigInt(a.item_id)<BigInt(b.item_id)?-1:1);
      return success(rows.filter(row=>!args.p_after || (args.p_kind==='friends'?row.item_id>args.p_after:BigInt(row.item_id)>BigInt(args.p_after))).slice(0,args.p_limit));
    }
    if (name === 'get_friend_recommendations') {
      const visible = users.filter(u => u.user_id === actor || u.is_private === false).map(u => u.user_id);
      const distances = new Map([[actor, 0]]), queue = [actor];
      for (let i=0; i<queue.length; i++) {
        const node = queue[i], distance = distances.get(node);
        if (distance >= 3) continue;
        for (const other of visible) if (!distances.has(other) && friendships.has(pair(node, other))) {
          distances.set(other, distance + 1); queue.push(other);
        }
      }
      const rows = users.filter(u => u.user_id !== actor && u.is_private === false).map(user => {
        const degree = distances.get(user.user_id);
        return { ...user, ...status(actor, user.user_id), connection_degree: [2,3].includes(degree) ? degree : null,
          mutual_friends: visible.filter(id => friendships.has(pair(actor, id)) && friendships.has(pair(user.user_id, id))).length,
          shared_events: [...(rsvps.get(actor) || [])].filter(event => rsvps.get(user.user_id)?.has(event)).length,
          shared_interests: [...(interests.get(actor) || [])].filter(interest => interests.get(user.user_id)?.has(interest)).length };
      }).sort((a,b) => (a.connection_degree ?? 99)-(b.connection_degree ?? 99) || b.shared_events-a.shared_events ||
        b.shared_interests-a.shared_interests || b.mutual_friends-a.mutual_friends || a.user_id.localeCompare(b.user_id));
      const offset = args.p_after ? rows.findIndex(u => u.user_id === args.p_after)+1 : 0;
      return success(rows.slice(offset).filter(u => u.relationship === 'none' &&
        (u.connection_degree || u.shared_events || u.shared_interests)).slice(0,args.p_limit));
    }
    if (name === 'get_friend_directory') {
      const query = (args.p_search || '').toLowerCase().trim().replace(/\s+/g, ' ');
      const rows = users.filter(u => u.user_id !== actor).map(user => {
        const mutual = users.filter(u => friendships.has(pair(actor, u.user_id)) && friendships.has(pair(user.user_id, u.user_id))).length;
        const shared = [...(rsvps.get(actor) || [])].filter(event => rsvps.get(user.user_id)?.has(event)).length;
        return { ...user, ...status(actor, user.user_id), match_rank: rankPerson(user, query),
          mutual_friends: user.is_private ? 0 : mutual, shared_events: user.is_private ? 0 : shared };
      }).filter(u => args.p_section === 'friends' ? u.relationship === 'friends'
        : args.p_section === 'requests' ? u.relationship.endsWith('_pending') : Boolean(query) || u.relationship === 'none')
        .filter(u => u.match_rank !== null)
        .sort((a, b) => a.match_rank - b.match_rank || (args.p_section === 'search' ? b.mutual_friends + b.shared_events - a.mutual_friends - a.shared_events : 0) || a.user_id.localeCompare(b.user_id));
      const offset = args.p_after ? rows.findIndex(u => u.user_id === args.p_after) + 1 : 0;
      return success(rows.slice(offset, offset + args.p_limit));
    }
    if (name === 'search_friend_people') return success(users.filter(user => user.user_id !== actor &&
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
  return { users, rsvps, interests, eventRecords, categoryRecords, attempts, friendships, calls, errors, rpc, status };
}
