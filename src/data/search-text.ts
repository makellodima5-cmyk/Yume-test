const LATIN_TO_RUSSIAN_KEYS: Record<string, string> = {
  q: "й", w: "ц", e: "у", r: "к", t: "е", y: "н", u: "г", i: "ш", o: "щ", p: "з",
  a: "ф", s: "ы", d: "в", f: "а", g: "п", h: "р", j: "о", k: "л", l: "д",
  z: "я", x: "ч", c: "с", v: "м", b: "и", n: "т", m: "ь",
};

const RUSSIAN_TO_LATIN_KEYS = Object.fromEntries(
  Object.entries(LATIN_TO_RUSSIAN_KEYS).map(([latin, cyrillic]) => [cyrillic, latin]),
) as Record<string, string>;

const VISUAL_CONFUSABLES = new Map<string, string>();
for (const [canonical, lookalikes] of [
  ["a", "а"], ["e", "е"], ["o", "о"], ["p", "р"], ["c", "с"],
  ["y", "у"], ["x", "х"], ["k", "к"], ["m", "м"], ["t", "т"],
  ["b", "в"], ["h", "н"], ["i", "і"], ["j", "ј"],
] as const) {
  VISUAL_CONFUSABLES.set(canonical, canonical);
  for (const character of lookalikes) VISUAL_CONFUSABLES.set(character, canonical);
}

/**
 * Normalizes cosmetic spelling differences without transliterating or flattening
 * non-Latin scripts. In particular, kana dakuten/handakuten are preserved.
 */
export function normalizeSearchText(value: string, locale = "ru"): string {
  return value
    .normalize("NFKC")
    .replace(/[Ёё]/g, "е")
    .normalize("NFD")
    .replace(/(\p{Script=Latin})\p{M}+/gu, "$1")
    .normalize("NFC")
    .toLocaleLowerCase(locale)
    .replace(/[‐‑‒–—―−]/g, " ")
    .replace(/['’ʼ`]/g, "")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function compact(value: string): string {
  return value.replace(/\s+/g, "");
}

export function foldVisualConfusables(value: string): string {
  return [...value].map((character) => VISUAL_CONFUSABLES.get(character) ?? character).join("");
}

function isLatinOnly(value: string): boolean {
  const letters = value.match(/\p{L}/gu) ?? [];
  return letters.length > 0 && letters.every((letter) => /\p{Script=Latin}/u.test(letter));
}

function isCyrillicOnly(value: string): boolean {
  const letters = value.match(/\p{L}/gu) ?? [];
  return letters.length > 0 && letters.every((letter) => /\p{Script=Cyrillic}/u.test(letter));
}

function switchKeyboardLayout(value: string, to: "latin" | "cyrillic"): string {
  const mapping = to === "cyrillic" ? LATIN_TO_RUSSIAN_KEYS : RUSSIAN_TO_LATIN_KEYS;
  return [...value].map((character) => mapping[character] ?? character).join("");
}

function maxEditDistance(length: number): number {
  if (length < 4) return 0;
  if (length <= 7) return 1;
  if (length <= 14) return 2;
  return Math.min(4, Math.floor(length * 0.22));
}

/** Bounded Damerau-Levenshtein distance; adjacent transpositions cost one edit. */
function editDistance(left: string, right: string, limit: number): number {
  if (Math.abs(left.length - right.length) > limit) return limit + 1;
  if (left === right) return 0;
  if (!left.length) return right.length;
  if (!right.length) return left.length;

  const rows: number[][] = Array.from({ length: left.length + 1 }, () => []);
  for (let i = 0; i <= left.length; i++) rows[i]![0] = i;
  for (let j = 0; j <= right.length; j++) rows[0]![j] = j;

  for (let i = 1; i <= left.length; i++) {
    let rowMinimum = limit + 1;
    for (let j = 1; j <= right.length; j++) {
      const substitution = rows[i - 1]![j - 1]! + (left[i - 1] === right[j - 1] ? 0 : 1);
      let value = Math.min(
        rows[i - 1]![j]! + 1,
        rows[i]![j - 1]! + 1,
        substitution,
      );
      if (
        i > 1 && j > 1 &&
        left[i - 1] === right[j - 2] &&
        left[i - 2] === right[j - 1]
      ) {
        value = Math.min(value, rows[i - 2]![j - 2]! + 1);
      }
      rows[i]![j] = value;
      rowMinimum = Math.min(rowMinimum, value);
    }
    if (rowMinimum > limit) return limit + 1;
  }
  return rows[left.length]![right.length]!;
}

type Field = { value: string; priority?: number };

/**
 * Returns a relevance score for a query against one or more title/genre fields.
 * Lower is better. A null result means there is no safe match.
 */
export function getSearchMatchScore(
  query: string,
  fields: Array<string | Field>,
  locale = "ru",
): number | null {
  const normalizedQuery = normalizeSearchText(query, locale);
  if (!normalizedQuery) return 0;

  const queryLetters = normalizedQuery;
  const queryFolded = foldVisualConfusables(normalizedQuery);
  const queryCompact = compact(normalizedQuery);
  const queryTokens = normalizedQuery.split(" ").filter(Boolean);
  const maxDistance = maxEditDistance(queryCompact.length);
  let best: number | null = null;

  const update = (score: number) => {
    if (best === null || score < best) best = score;
  };

  for (const rawField of fields) {
    const value = typeof rawField === "string" ? rawField : rawField.value;
    const priority = typeof rawField === "string" ? 0 : (rawField.priority ?? 0);
    const normalizedField = normalizeSearchText(value, locale);
    if (!normalizedField) continue;

    if (normalizedField === normalizedQuery) update(priority);
    else if (normalizedField.includes(normalizedQuery)) update(priority + 10);

    const foldedField = foldVisualConfusables(normalizedField);
    if (foldedField === queryFolded) update(priority + 20);
    else if (foldedField.includes(queryFolded)) update(priority + 25);

    let layoutQuery: string | null = null;
    if (isLatinOnly(queryLetters) && isCyrillicOnly(normalizedField)) {
      layoutQuery = normalizeSearchText(switchKeyboardLayout(normalizedQuery, "cyrillic"), locale);
    } else if (isCyrillicOnly(queryLetters) && isLatinOnly(normalizedField)) {
      layoutQuery = normalizeSearchText(switchKeyboardLayout(normalizedQuery, "latin"), locale);
    }
    if (layoutQuery) {
      if (normalizedField === layoutQuery) update(priority + 35);
      else if (normalizedField.includes(layoutQuery)) update(priority + 40);
    }

    if (maxDistance > 0 && queryCompact.length >= 4) {
      const fieldCompact = compact(normalizedField);
      if (Math.abs(fieldCompact.length - queryCompact.length) <= maxDistance) {
        const distance = editDistance(queryCompact, fieldCompact, maxDistance);
        if (distance <= maxDistance) update(priority + 60 + distance);
      }

      const candidateTokens = normalizedField.split(" ").filter(Boolean);
      const variants = [normalizedQuery, queryFolded];
      if (layoutQuery) variants.push(layoutQuery);
      for (const variant of variants) {
        const tokens = variant.split(" ").filter(Boolean);
        if (!tokens.length) continue;
        let totalDistance = 0;
        let allTokensMatch = true;
        for (const token of tokens) {
          if (candidateTokens.some((candidate) => candidate.includes(token))) continue;
          if (token.length < 4) {
            allTokensMatch = false;
            break;
          }
          const tokenLimit = maxEditDistance(token.length);
          let bestTokenDistance = tokenLimit + 1;
          for (const candidate of candidateTokens) {
            if (Math.abs(candidate.length - token.length) > tokenLimit) continue;
            bestTokenDistance = Math.min(bestTokenDistance, editDistance(token, candidate, tokenLimit));
            if (bestTokenDistance === 0) break;
          }
          if (bestTokenDistance > tokenLimit) {
            allTokensMatch = false;
            break;
          }
          totalDistance += bestTokenDistance;
        }
        if (allTokensMatch && totalDistance > 0) update(priority + 80 + totalDistance);
      }
    }
  }

  return best;
}

/** Convenient boolean matcher for smaller legacy search paths. */
export function matchesSearchQuery(query: string, values: string[], locale = "ru"): boolean {
  return getSearchMatchScore(query, values, locale) !== null;
}
