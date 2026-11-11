import { createClient } from "@supabase/supabase-js";
import { categorizeEvent } from "./gemini.js";

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_AI_SECRET_KEY,
  {
    auth: {
      persistSession: false,
      autoRefreshToken: false
    }
  }
);

export async function classifyAndSaveEvent(event) {
  // 1. Get approved categories from Supabase
  const { data: categoryRows, error: categoryError } =
    await supabase
      .from("EventCategory")
      .select("EventCatID, EventCatagory");

  if (categoryError) throw categoryError;

  const categoryNames = categoryRows.map(
    row => row.EventCatagory
  );

  // 2. Ask Gemini to categorize the event
  const classification = await categorizeEvent(
    {
      name: event.EventName,
      description: event.EventDescription
    },
    categoryNames
  );

  // 3. Convert category names to database IDs
  const links = classification.categories.map(name => {
    const category = categoryRows.find(
      row => row.EventCatagory === name
    );

    return {
      EventID: event.EventID,
      EventCatID: category.EventCatID,
      IsPrimary: name === classification.primary
    };
  });

  // 4. Save categories atomically through Supabase RPC
const { error: saveError } = await supabase.rpc(
  "save_ai_event_categories",
  {
    p_event_id: event.EventID,
    p_category_ids: links.map(link => link.EventCatID),
    p_primary_category_id: links.find(
      link => link.IsPrimary
    ).EventCatID
  }
);

  if (saveError) throw saveError;

  return classification;
}