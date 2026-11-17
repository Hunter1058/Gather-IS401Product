const GEMINI_MODEL = "gemini-3.5-flash-lite";

export async function categorizeEvent(event, allowedCategories) {
  const apiKey = process.env.GEMINI_API_KEY;

  if (!apiKey) {
    throw new Error("GEMINI_API_KEY is missing.");
  }

  const prompt = `
You categorize university events for Gather.

Event name: ${event.name}
Event description: ${event.description || "No description"}

Choose 1 to 3 categories from this exact list:
${JSON.stringify(allowedCategories)}

Rules:
- Only use categories from the provided list.
- Choose the most relevant category as primary.
- The primary category must appear in categories.
- Return JSON only.
`;


let response;

for (let attempt = 1; attempt <= 3; attempt++) {
  response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": apiKey,
      },
      body: JSON.stringify({
        contents: [
          {
            role: "user",
            parts: [{ text: prompt }],
          },
        ],
        generationConfig: {
          responseMimeType: "application/json",
          responseSchema: {
            type: "OBJECT",
            properties: {
              primary: { type: "STRING" },
              categories: {
                type: "ARRAY",
                items: { type: "STRING" },
              },
            },
            required: ["primary", "categories"],
          },
          temperature: 0.2,
        },
      }),
    }
  );

    if (response.ok) break;

  const errorBody = await response.text();

  if (![429, 500, 502, 503, 504].includes(response.status) || attempt === 3) {
    throw new Error(
      `Gemini request failed: ${response.status} - ${errorBody.slice(0, 500)}`
    );
  }

  console.log(`Gemini unavailable (${response.status}). Retry ${attempt}/2...`);

  await new Promise(resolve =>
    setTimeout(resolve, 2000 * attempt)
  );
}

  if (!response.ok) {
    throw new Error(`Gemini request failed: ${response.status}`);
  }

  const result = await response.json();
  const content = result.candidates?.[0]?.content?.parts?.[0]?.text;

  if (!content) {
    throw new Error("Gemini returned no classification.");
  }

  const classification = JSON.parse(content);
  const allowed = new Set(allowedCategories);

  const categories = [
    ...new Set(classification.categories),
  ].filter(category => allowed.has(category)).slice(0, 3);

  if (
    !allowed.has(classification.primary) ||
    !categories.includes(classification.primary)
  ) {
    throw new Error("Gemini returned an invalid primary category.");
  }

  return {
    primary: classification.primary,
    categories,
  };
}