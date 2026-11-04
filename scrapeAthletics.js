async function main() {
    const { load } = await import("cheerio");
    const { config } = await import("dotenv");
    const { createClient } = await import("@supabase/supabase-js");
  
    config();
  
    const supabase = createClient(
      process.env.SUPABASE_URL,
      process.env.SUPABASE_SECRET_KEY
    );
  
    const month = "2026-12";
    const sports = [
      ["Football", "football"],
      ["Men’s Basketball", "mens-basketball"],
      ["Women’s Basketball", "womens-basketball"],
      ["Men’s Volleyball", "mens-volleyball"],
      ["Women’s Volleyball", "womens-volleyball"]
    ];
  
    let failed = false;
  
    for (const [sport, slug] of sports) {
      const scheduleUrl = `https://byucougars.com/sports/${slug}/schedule`;
  
      try {
        const response = await fetch(scheduleUrl, {
          signal: AbortSignal.timeout(20_000)
        });
  
        if (!response.ok) {
          throw new Error(`Schedule request failed (${response.status})`);
        }
  
        const $ = load(await response.text());
        const cards = $(".schedule-event-item");
  
        if (!cards.length) {
          throw new Error("No game cards found in the schedule HTML");
        }
  
        const events = new Map();
  
        cards.each((_, card) => {
          const game = $(card);
          const dateBlock = game.find(".schedule-event-date").first();
  
          if (!dateBlock.hasClass("schedule-event-date--venue-home")) return;
  
          const dateTime = dateBlock.find("time[datetime]").first().attr("datetime");
          if (!dateTime?.startsWith(`${month}-`)) return;
  
          const gameId = game.find(".schedule-event-item__dashboard-link")
            .first().attr("entity-id");
  
          if (!gameId) {
            throw new Error(`Missing game ID for a home game on ${dateTime.slice(0, 10)}`);
          }
  
          const opponent = game.find(".schedule-event-item__opponent-name")
            .first().text().trim();
          const venue = game.find(".schedule-event-item__location-venue")
            .first().text().trim();
          const startTime = dateTime.match(/T(\d{2}:\d{2}:\d{2})/)?.[1];
          const sourceUrl = `${scheduleUrl}#game-${gameId}`;
  
          events.set(sourceUrl, {
            EventName: `BYU ${sport} vs. ${opponent || "TBD"}`,
            EventDate: dateTime.slice(0, 10),
            EventTime: dateBlock.hasClass("schedule-event-date--time-tba")
              ? null
              : startTime || null,
            EventLocation: venue || null,
            SourceURL: sourceUrl
          });
        });
  
        if (events.size === 0) {
          console.log(`${sport} — no home games listed for ${month}`);
          continue;
        }
  
        const { error } = await supabase
          .from("Events")
          .upsert([...events.values()], { onConflict: "SourceURL" });
  
        if (error) throw new Error(error.message);
  
        console.log(`${sport} — saved or updated ${events.size} games`);
      } catch (error) {
        failed = true;
        console.error(`${sport} — ${error.message}`);
      }
    }
  
    if (failed) process.exitCode = 1;
  }
  
  main().catch(error => {
    console.error(error.message);
    process.exitCode = 1;
  });