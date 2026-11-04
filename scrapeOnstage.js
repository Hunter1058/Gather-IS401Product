function toDatabaseTime(value) {
  if (!value || !value.trim()) return null;

  const match = value.trim().match(
    /^(\d{1,2}):(\d{2})\s*(AM|PM)$/i
  );

  if (!match) {
    throw new Error(`Unrecognized time: ${value}`);
  }

  let hour = Number(match[1]);
  const minute = Number(match[2]);

  if (hour < 1 || hour > 12 || minute > 59) {
    throw new Error(`Invalid time: ${value}`);
  }

  hour %= 12;

  if (match[3].toUpperCase() === "PM") {
    hour += 12;
  }

  return `${String(hour).padStart(2, "0")}:${match[2]}:00`;
}

async function fetchHtml(url) {
  const response = await fetch(url, {
    signal: AbortSignal.timeout(20000),
    redirect: "error"
  });

  if (!response.ok) {
    throw new Error(`Request failed (${response.status}): ${url}`);
  }

  return response.text();
}

async function main() {
  const { load } = await import("cheerio");
  const dotenv = await import("dotenv");
  const { createClient } = await import("@supabase/supabase-js");

  dotenv.config();

  if (
    !process.env.SUPABASE_URL ||
    !process.env.SUPABASE_SECRET_KEY
  ) {
    throw new Error("Missing Supabase settings in .env.");
  }

  const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SECRET_KEY
  );

  // Test the connection.
  const { error } = await supabase
    .from("Events")
    .select("EventID")
    .limit(1);

  if (error) {
    throw new Error(error.message);
  }

  console.log("Connected to Supabase!");

  // Change this URL later to collect another month.
  const calendarUrl = "https://onstage.byu.edu/month/2026-12";
  const calendarHtml = await fetchHtml(calendarUrl);
  const calendar = load(calendarHtml);

  const rawEvents = calendar("event-calendar").attr("data-events");

  if (!rawEvents) {
    throw new Error("Calendar event data not found.");
  }

  const calendarEvents = JSON.parse(rawEvents);

  if (!Array.isArray(calendarEvents)) {
    throw new Error("Expected an array of calendar events.");
  }

  console.log(`Found ${calendarEvents.length} event records.`);
  console.log("Importing November events...");

  let savedCount = 0;

  for (const item of calendarEvents) {
    if (typeof item.url !== "string" || !item.url.trim()) {
      throw new Error("Calendar event is missing its URL.");
    }

    const url = new URL(item.url, calendarUrl);

    if (url.origin !== "https://onstage.byu.edu") {
      throw new Error(`Unexpected event host: ${url.hostname}`);
    }

    console.log(`Reading: ${item.title}`);

    const html = await fetchHtml(url.href);
    const $ = load(html);

    // Preserve the source's local date without timezone conversion.
    const dateMatch = String(item.date).match(
      /^(\d{4}-\d{2}-\d{2})T/
    );

    if (!dateMatch) {
      throw new Error(`Unrecognized date: ${item.date}`);
    }

    const duration =
      $(".EventPage-eventDuration").first().text().trim() ||
      item.duration ||
      "";

    const times = duration.split(/\s*[-–—]\s*/);

    const imageSrc = $(".EventPage-image img")
      .first()
      .attr("src");

    const event = {
      EventName: $(".EventPage-headline").first().text().trim(),

      // Collect the first description paragraph.
      EventDescription:
        $(".EventPage-eventBody > p").first().text().trim() || null,

      EventDate: dateMatch[1],

      EventTime: toDatabaseTime(times[0]),

      // Leave the end time empty when it isn't supplied.
      EventEndTime: times[1]
        ? toDatabaseTime(times[1])
        : null,

      EventLocation:
        $(".EventPage-eventLocation").first().text().trim() || null,

      EventImage: imageSrc
        ? new URL(imageSrc, url.href).href
        : null,

      SourceURL: url.href
    };

    if (!event.EventName) {
      throw new Error(`Event title missing: ${url.href}`);
    }

    // Insert new events or update an existing matching SourceURL.
    const { error: saveError } = await supabase
      .from("Events")
      .upsert(event, { onConflict: "SourceURL" });

    if (saveError) {
      throw new Error(
        `Could not save "${event.EventName}": ${saveError.message}`
      );
    }

    savedCount += 1;

    console.log(
      `Saved ${savedCount}/${calendarEvents.length}: ${event.EventName}`
    );

    // Pause between requests.
    await new Promise(resolve => setTimeout(resolve, 1000));
  }

  console.log(
    `Import complete. Saved or updated ${savedCount} event records.`
  );
}

main().catch(error => {
  console.error(error.message);
  process.exitCode = 1;
});