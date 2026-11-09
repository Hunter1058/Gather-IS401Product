import assert from 'node:assert/strict';
// A minimal PostgREST-shaped test double, not a substitute for database RLS tests.
export const USER_A = '11111111-1111-4111-8111-111111111111';
export const USER_B = '22222222-2222-4222-8222-222222222222';
export function database() {
  const rows = {
    User: [{ UserID: USER_A }, { UserID: USER_B }],
    Events: [{ EventID: '1' }, { EventID: '2' }], EventCategory: [], Bookmark: [], RSVP: [],
  };
  const errors = new Map();
  const calls = [];
  const client = {
    from(table) {
      assert.ok(Object.hasOwn(rows, table), `Missing fixture data for table ${table}`);
      let operation = 'select', payload, filters = [], singular = false, projection;
      const q = {
        select(value) { projection = value; return q; },
        order() { return q; },
        limit() { return q; },
        eq(column, value) { filters.push([column, value]); return q; },
        upsert(value, options) { operation = 'upsert'; payload = value; assert.equal(options.onConflict, 'UserID,EventID'); return q; },
        delete() { operation = 'delete'; return q; },
        single() { singular = true; return q; },
        maybeSingle() { singular = true; return q; },
        then(resolve, reject) {
          return Promise.resolve().then(() => {
            calls.push({ table, operation, payload, filters, projection });
            if (errors.has(table)) return { data: null, error: errors.get(table) };
            const matches = row => filters.every(([key, value]) => String(row[key]) === String(value));
            let data;
            if (operation === 'upsert') {
              let row = rows[table].find(row => row.UserID === payload.UserID && row.EventID === payload.EventID);
              if (row) Object.assign(row, payload);
              else { row = { ...payload }; rows[table].push(row); }
              data = [row];
            } else {
              data = rows[table].filter(matches);
              if (operation === 'delete') rows[table] = rows[table].filter(row => !matches(row));
            }
            return { data: singular ? data[0] || null : data, error: null };
          }).then(resolve, reject);
        },
      };
      return q;
    },
  };
  return { rows, errors, calls, client };
}
