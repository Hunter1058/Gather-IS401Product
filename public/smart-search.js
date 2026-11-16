
function searchDistance(a, b) {
  const previous = Array.from({ length: b.length + 1 }, (_, i) => i);

  for (let i = 1; i <= a.length; i++) {
    const current = [i];

    for (let j = 1; j <= b.length; j++) {
      current[j] = Math.min(
        current[j - 1] + 1,
        previous[j] + 1,
        previous[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)
      );
    }

    previous.splice(0, previous.length, ...current);
  }

  return previous[b.length];
}

function smartEventMatch(event, query) {
  const search = query.trim().toLowerCase();
  if (!search) return true;

  const content = [
    event.name,
    event.club,
    event.location,
    event.category,
    ...(event.categories || [])
  ].filter(Boolean).join(" ").toLowerCase();

  // Exact and partial matches take priority.
  if (content.includes(search)) return true;

  const words = content.match(/[a-z0-9]+/g) || [];
  const queryWords = search.match(/[a-z0-9]+/g) || [];

  return queryWords.every(queryWord =>
    words.some(word => {
      if (word.includes(queryWord)) return true;

      // Avoid overly broad fuzzy matches for short words.
      if (queryWord.length < 4) return false;

      const tolerance = queryWord.length >= 8 ? 2 : 1;
      return searchDistance(queryWord, word) <= tolerance;
    })
  );
}
