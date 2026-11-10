import { createClient } from "@supabase/supabase-js";
import { classifyAndSaveEvent } from "./lib/ai-categories.js";

const db = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_AI_SECRET_KEY
);

// Get events
const { data: events, error } = await db
  .from("Events")
  .select("EventID, EventName, EventDescription")
  .order("EventID")
  .limit(500);

if (error) throw error;

// Get events that already have categories
const { data: existingLinks, error: linksError } = await db
  .from("Event_Category_Linking_Table")
  .select("EventID");

if (linksError) throw linksError;

const categorizedIds = new Set(existingLinks.map(link => link.EventID));

const remaining = events.filter(
  event => !categorizedIds.has(event.EventID)
);

console.log(`${remaining.length} events need categorization.`);

// Process a small batch to stay within Gemini API limits
const batch = remaining.slice(0, 5);

for (const event of batch) {
  try {
    console.log(`Categorizing ${event.EventID}: ${event.EventName}`);

    const result = await classifyAndSaveEvent(event);

    console.log(`✓ ${result.primary}: ${result.categories.join(", ")}`);
  } catch (error) {
    console.error(`✗ Event ${event.EventID}: ${error.message}`);
  }

  // Wait between Gemini requests
  await new Promise(resolve => setTimeout(resolve, 3000));
}

console.log("Batch complete!");
