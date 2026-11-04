async function fetchHtml(url) {
    const response = await fetch(url, {
      signal: AbortSignal.timeout(15_000),
      redirect: "error"
    });
  
    if (!response.ok) {
      const error = new Error(`HTTP ${response.status} for ${url}`);
      error.status = response.status;
      throw error;
    }
  
    return response.text();
  }
  
  function toDatabaseTime(value) {
    const match = value.trim().match(/^(\d{1,2}):(\d{2})\s*(AM|PM)$/i);
    if (!match) return null;
  
    const [, hours, minutes, period] = match;
    const hour = Number(hours);
  
    if (hour < 1 || hour > 12 || Number(minutes) > 59) return null;
  
    const hour24 = (hour % 12) + (period.toUpperCase() === "PM" ? 12 : 0);
    return `${String(hour24).padStart(2, "0")}:${minutes}:00`;
  }
  
  async function main() {
    const { load } = await import("cheerio");
  
    const args = process.argv.slice(2);
    const month = args.find(arg => !arg.startsWith("--")) || "2026-11";
    const shouldSave = args.includes("--save");
  
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) {
      throw new Error("Enter the month as YYYY-MM.");
    }
  
    const origin = "https://calendar.byu.edu";
    const calendarUrl = `${origin}/month/${month}`;
    const calendar = load(await fetchHtml(calendarUrl));
    const rawEvents = calendar("event-calendar").attr("data-events");
  
    if (!rawEvents) throw new Error("Calendar event data not found.");
  
    const items = JSON.parse(rawEvents);
    if (!Array.isArray(items)) throw new Error("Expected a calendar event list.");
  
    const candidates = new Map();
  
    for (const item of items) {
      if (!item.url || !item.title) continue;
      if (/\b(?:deadline|due date|due)\s*$/i.test(item.title.trim())) continue;
  
      const url = new URL(item.url, calendarUrl);
      const date = String(item.date).match(/^(\d{4}-\d{2}-\d{2})T/)?.[1];
  
      if (
        url.origin !== origin ||
        /^\/athletics(?:\/|$)/i.test(url.pathname) ||
        !date?.startsWith(`${month}-`)
      ) {
        continue;
      }
  
      const sourceUrl = `${url.origin}${url.pathname.replace(/\/+$/, "")}`;
      candidates.set(sourceUrl, { item, date });
    }
  
    console.log(`Found ${candidates.size} central-calendar listings for ${month}.`);
  
    const rows = [];
  
    for (const [sourceUrl, { item, date }] of candidates) {
      try {
        const detail = load(await fetchHtml(sourceUrl));
        const name = detail(".EventPage-headline").first().text().trim();
  
        if (!name) throw new Error("Event title missing from the detail page.");
  
        const duration =
          detail(".EventPage-eventDuration").first().text().trim() ||
          item.duration ||
          "";
        const [start = "", end = ""] = duration.split(/\s*[-–—]\s*/);
  
        const description = detail(".EventPage-eventBody > p")
          .map((_, paragraph) => detail(paragraph).text().trim())
          .get()
          .filter(Boolean)
          .join("\n\n");
  
        const location = detail(".EventPage-eventLocation").first().text().trim();
        const imageSrc = detail(".EventPage-image img[src]")
          .first()
          .attr("src")
          ?.trim();
  
        const row = {
          EventName: name,
          EventDate: date,
          SourceURL: sourceUrl
        };
  
        const startTime = toDatabaseTime(start);
        const endTime = toDatabaseTime(end);
  
        if (startTime) row.EventTime = startTime;
        if (endTime) row.EventEndTime = endTime;
        if (location) row.EventLocation = location;
        if (description) row.EventDescription = description;
  
        if (imageSrc) {
          const imageUrl = new URL(imageSrc, sourceUrl);
          if (imageUrl.protocol === "https:") {
            row.EventImage = imageUrl.href;
          }
        }
  
        rows.push(row);
      } catch (error) {
        if ([401, 403, 429].includes(error.status)) throw error;
        console.warn(`Skipped "${item.title}" — ${error.message}`);
      }
  
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
  
    console.table(rows.map(row => ({
      EventName: row.EventName,
      EventDate: row.EventDate,
      EventTime: row.EventTime ?? "—",
      EventLocation: row.EventLocation ?? "—",
      EventImage: row.EventImage ? "Found" : "Missing",
      EventDescription: row.EventDescription?.slice(0, 80) ?? "—"
    })));
  
    const imageCount = rows.filter(row => row.EventImage).length;
    console.log(`Prepared ${rows.length} of ${candidates.size} listings.`);
    console.log(`Found images for ${imageCount} of ${rows.length} events.`);
  
    if (!shouldSave || rows.length === 0) return;
  
    const { config } = await import("dotenv");
    const { createClient } = await import("@supabase/supabase-js");
    config();
  
    const supabaseUrl = process.env.SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_SECRET_KEY;
  
    if (!supabaseUrl || !supabaseKey) {
      throw new Error("Missing Supabase settings in .env.");
    }
  
    const supabase = createClient(supabaseUrl, supabaseKey);
    let saved = 0;
  
    for (const row of rows) {
      const { error } = await supabase
        .from("Events")
        .upsert(row, { onConflict: "SourceURL" });
  
      if (error) {
        throw new Error(
          `Couldn't save "${row.EventName}" after ${saved} saves: ${error.message}`
        );
      }
  
      saved += 1;
    }
  
    console.log(`Saved or updated ${saved} BYU Calendar events.`);
  }
  
  main().catch(error => {
    console.error(error.message);
    process.exitCode = 1;
  });