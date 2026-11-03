// The browser supplies an event and a desired state, never the owner UserID.
// Supabase receives the signed-in user's JWT, so RLS also enforces ownership.
export function planInput(eventId, input, field) {
  if (!/^[1-9]\d{0,18}$/.test(eventId) || BigInt(eventId) > 9223372036854775807n)
    throw Object.assign(Error("Invalid event ID."), { status: 400 });
  if (!input || typeof input !== "object" || Array.isArray(input) ||
      Object.keys(input).length !== 1 || typeof input[field] !== "boolean")
    throw Object.assign(Error(`Send only ${field} as true or false.`), { status: 400 });
  return input[field];
}

function checked(result) {
  if (result.error) {
    // Only error codes are logged by the HTTP handler, never database details.
    if (["42P01", "42703", "42P10", "PGRST204", "PGRST205"].includes(result.error.code))
      throw Object.assign(Error("Database setup is incomplete. Apply the event plans migration."), { status: 503 });
    throw result.error;
  }
  return result.data;
}

export async function profileId(client, authUserId) {
  const profile = checked(await client.from("User").select("UserID")
    .eq("UserID", authUserId).maybeSingle());
  if (!profile) throw Object.assign(Error("Your account profile is missing. Ask the administrator to apply the event plans migration."), { status: 503 });
  // The live profile primary key is the same UUID as the verified Auth user.
  return profile.UserID;
}

export async function readPlans(client, userId) {
  const results = await Promise.all([
    client.from("Bookmark").select("EventID").eq("UserID", userId),
    client.from("RSVP").select("EventID").eq("UserID", userId).eq("RSVPGoing", true),
  ]);
  const [bookmarks, rsvps] = results.map(checked);
  return {
    saved: bookmarks.map(row => String(row.EventID)),
    rsvp: rsvps.map(row => String(row.EventID)),
    attended: [], friends: [], interests: [], reminders: {}, surveys: {},
  };
}

export async function writePlan(client, userId, eventId, kind, value) {
  const event = checked(await client.from("Events").select("EventID")
    .eq("EventID", eventId).maybeSingle());
  if (!event) throw Object.assign(Error("This event is no longer available."), { status: 404 });

  if (kind === "bookmark") {
    if (value) {
      checked(await client.from("Bookmark").upsert(
        { UserID: userId, EventID: eventId }, { onConflict: "UserID,EventID" },
      ).select("EventID").single());
    } else {
      checked(await client.from("Bookmark").delete()
        .eq("UserID", userId).eq("EventID", eventId).select("EventID"));
    }
    return { eventId, bookmarked: value };
  }

  // Canceling records false; later friend queries must filter RSVPGoing = true.
  const row = checked(await client.from("RSVP").upsert(
    { UserID: userId, EventID: eventId, RSVPGoing: value },
    { onConflict: "UserID,EventID" },
  ).select("RSVPGoing").single());
  return { eventId, going: row.RSVPGoing };
}
