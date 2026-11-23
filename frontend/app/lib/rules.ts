// House rules: which words count. Sent with every solve; the solver builds a
// dictionary of just the allowed words, so crossings obey the rules too.

export type WordChoice = "any" | "common" | "strict";
export type WordClass = "n" | "v" | "a" | "o";
export type Ban = { word: string; reason: string };

export type Rules = {
  choice: WordChoice;
  minLen: number;
  maxLen: number | null;
  classes: Record<WordClass, boolean>;
  plurals: boolean;
  banned: Ban[];
};

export const DEFAULT_RULES: Rules = {
  choice: "common",
  minLen: 2,
  maxLen: null,
  classes: { n: true, v: true, a: true, o: true },
  plurals: false,
  banned: [],
};

export const CHOICES: { value: WordChoice; label: string; detail: string }[] = [
  { value: "any", label: "Any", detail: "Every word in the dictionary, however rare or long." },
  { value: "common", label: "Common", detail: "Words people actually use. Solves about as often as Any." },
  { value: "strict", label: "Strict", detail: "Only very common words. Some hands need a dump to fit." },
];

export const CLASSES: { value: WordClass; label: string }[] = [
  { value: "n", label: "Nouns" },
  { value: "v", label: "Verbs" },
  { value: "a", label: "Adjectives" },
  { value: "o", label: "Other" },
];

export const MIN_LEN = 2;
export const MAX_LEN = 15;

/** The request fields the solver reads (all strings). */
export function rulesToWire(r: Rules): Record<string, string> {
  const wire: Record<string, string> = {
    plurals: r.plurals ? "1" : "0",
    min_len: String(r.minLen),
  };
  if (r.choice === "common") wire.common = "1";
  if (r.choice === "strict") wire.common = "20000";
  if (r.maxLen != null) wire.max_len = String(r.maxLen);
  if (!Object.values(r.classes).every(Boolean)) {
    // "Other" covers numerals (u) and everything else (o).
    wire.classes = (Object.keys(r.classes) as WordClass[])
      .filter((c) => r.classes[c])
      .map((c) => (c === "o" ? "uo" : c))
      .join("");
  }
  if (r.banned.length) wire.banned = r.banned.map((b) => b.word).join(",");
  return wire;
}

export function rulesKey(r: Rules) {
  return JSON.stringify(rulesToWire(r));
}

export function lengthLabel(r: Rules) {
  if (r.maxLen != null && r.maxLen === r.minLen) return `exactly ${r.minLen} letters`;
  if (r.maxLen != null && r.minLen > MIN_LEN) return `${r.minLen}–${r.maxLen} letters`;
  if (r.maxLen != null) return `up to ${r.maxLen} letters`;
  if (r.minLen > MIN_LEN) return `${r.minLen}+ letters`;
  return null;
}

/** One line for the rules button, e.g. "Common · 4–6 letters · nouns · 2 banned". */
export function summarize(r: Rules) {
  const parts: string[] = [CHOICES.find((c) => c.value === r.choice)!.label + " words"];
  const len = lengthLabel(r);
  if (len) parts.push(len);
  const on = CLASSES.filter((c) => r.classes[c.value]);
  if (on.length < CLASSES.length) parts.push(on.map((c) => c.label.toLowerCase()).join(", ") + " only");
  if (r.plurals) parts.push("plurals OK");
  if (r.banned.length) parts.push(`${r.banned.length} banned`);
  return parts.join(" · ");
}
