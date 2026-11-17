// Caller-scoped, paginated summaries. No caller-supplied user ID is accepted.
const PAGE_SIZE = 250, MAX_PAGES = 40, MAX_ID = 9223372036854775807n;
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function positiveText(value) {
  return typeof value === 'string' && /^[1-9]\d{0,18}$/.test(value) && BigInt(value) <= MAX_ID;
}
export async function readFriendAttendance(client) {
  const friendsGoing = [], friendAttendance = {};
  let after = null;
  for (let page = 0; page < MAX_PAGES; page++) {
    const result = await client.rpc('gather_event_friend_attendance', {
      p_after_event_id: after, p_limit: PAGE_SIZE,
    });
    if (result.error) throw result.error;
    if (!Array.isArray(result.data) || result.data.length > PAGE_SIZE)
      throw Error('Invalid friend attendance response.');
    // Continue until an empty page, even if PostgREST has a lower row cap.
    if (!result.data.length) return {friendsGoing, friendAttendance};
    for (const row of result.data) {
      if (!row || !positiveText(row.event_id) || !positiveText(row.friend_count) ||
          (after !== null && BigInt(row.event_id) <= BigInt(after)) ||
          !Array.isArray(row.friends) || row.friends.length !== Number(BigInt(row.friend_count) < 2n ? BigInt(row.friend_count) : 2n))
        throw Error('Invalid friend attendance response.');
      const seen = new Set();
      const friends = row.friends.map(friend => {
        if (!friend || typeof friend.id !== 'string' || !uuid.test(friend.id) || seen.has(friend.id) ||
            typeof friend.label !== 'string' || !friend.label.trim() || Array.from(friend.label).length > 80)
          throw Error('Invalid friend attendance response.');
        seen.add(friend.id);
        return {id: friend.id, label: friend.label};
      });
      friendsGoing.push(row.event_id);
      friendAttendance[row.event_id] = {count: row.friend_count, friends};
      after = row.event_id;
    }
  }
  // Never return a successful partial snapshot when a safety bound is reached.
  throw Error('Friend attendance exceeded its page limit.');
}
