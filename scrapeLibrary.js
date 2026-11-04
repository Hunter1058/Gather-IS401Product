function toDatabaseTime(value) {
    const match = value.match(/^(\d{1,2}):(\d{2})\s*(AM|PM)$/i);
    if (!match) return null;
  
    const [, hours, minutes, period] = match;
    const hour = Number(hours);
  
    if (hour < 1 || hour > 12 || Number(minutes) > 59) return null;
  
    const hour24 = (hour % 12) + (period.toUpperCase() === "PM" ? 12 : 0);
    return `${String(hour24).padStart(2, "0")}:${minutes}:00`;
  }
  
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
  
  async function main() {
    const { load } = await import("cheerio");
    const listingUrl = "https://lib.byu.edu/events/";
    const shouldSave = process.argv.includes("--save");
  
    const $ = load(await fetchHtml(listingUrl));
    const items = $("ul.dates.events > li");
  
    if (!items.length) {
      throw new Error("No Library event listings found.");
    }
  
    const events = new Map();
  
    items.each((_, element) => {
      const item = $(element);
      const link = item.find("h3 a[href]").first();
      const name = link.text().trim();
      const href = link.attr("href");
  
      if (!name || !href) return;
  
      const url = new URL(href, listingUrl);
      const date = url.pathname.match(/(\d{4}-\d{2}-\d{2})\/?$/)?.[1];
  
      if (url.origin !== "https://calendar.byu.edu" || !date) {
        console.warn(`Skipped "${name}": no supported link with a full date.`);
        return;
      }
  
      const timeText = item.find("time .time").first().text().trim();
      const time = toDatabaseTime(timeText);
  
      if (timeText && !time) {
        console.warn(`Unrecognized time for "${name}": ${timeText}`);
      }
  
      const sourceUrl = `${url.origin}${url.pathname.replace(/\/+$/, "")}`;
  
      events.set(sourceUrl, {
        EventName: name,
        EventDate: date,
        EventTime: time,
        EventLocation: item.find(".location").first().text().trim() || null,
        SourceURL: sourceUrl
      });
    });
  
    const rows = [...events.values()];
  
    if (!rows.length) {
      throw new Error("No Library listings could be prepared for import.");
    }
  
    for (const row of rows) {
      try {
        const detail = load(await fetchHtml(row.SourceURL));
  
        // Join the description paragraphs as plain text.
        const description = detail(".EventPage-eventBody > p")
          .map((_, paragraph) => detail(paragraph).text().trim())
          .get()
          .filter(Boolean)
          .join("\n\n");
  
        if (description) {
          row.EventDescription = description;
        } else {
          console.warn(`No description found for "${row.EventName}".`);
        }
      } catch (error) {
        if ([401, 403, 429].includes(error.status)) throw error;
        console.warn(`Couldn't read "${row.EventName}": ${error.message}`);
      }
  
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
  
    console.table(
      rows.map(row => ({
        EventName: row.EventName,
        EventDate: row.EventDate,
        EventDescription: row.EventDescription?.slice(0, 100) ?? "(missing)"
      }))
    );
  
    const described = rows.filter(row => row.EventDescription).length;
    console.log(`Found descriptions for ${described} of ${rows.length} events.`);
  
    if (!shouldSave) return;
  
    const { config } = await import("dotenv");
    const { createClient } = await import("@supabase/supabase-js");
    config();
  
    const supabase = createClient(
      process.env.SUPABASE_URL,
      process.env.SUPABASE_SECRET_KEY
    );
  
    let saved = 0;
  
    for (const row of rows) {
      const { error } = await supabase
        .from("Events")
        .upsert(row, { onConflict: "SourceURL" });
  
      if (error) {
        throw new Error(
          `Couldn't save "${row.EventName}" after ${saved} successful saves: ${error.message}`
        );
      }
  
      saved += 1;
    }
  
    console.log(`Saved or updated ${saved} Library events.`);
  }
  
  main().catch(error => {
    console.error(error.message);
    process.exitCode = 1;
  });