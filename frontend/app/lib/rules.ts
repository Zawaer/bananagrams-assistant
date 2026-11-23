// House rules: which words count. Sent with every solve; the solver builds a
// dictionary of just the allowed words, so crossings obey the rules too.

export type WordChoice = "any" | "common" | "strict";
// Word classes from the Kotus list: n noun, v verb, a adjective, u numeral,
// q pronoun, b adverb, c conjunction/preposition/postposition and "ei",
// i interjection. (The lexicon's leftover "o" rides along with adverbs.)
export type WordClass = "n" | "v" | "a" | "u" | "q" | "b" | "c" | "i";
export type Ban = { word: string; reason: string };
/** Usage labels from Kielitoimiston sanakirja. */
export type Style = "k" | "s" | "r" | "d" | "m";

export type Rules = {
  choice: WordChoice;
  minLen: number;
  maxLen: number | null;
  classes: Record<WordClass, boolean>;
  plurals: boolean;
  styles: Record<Style, boolean>;
  banned: Ban[];
};

export const DEFAULT_RULES: Rules = {
  choice: "common",
  minLen: 2,
  maxLen: null,
  // The usual house rules: no pronouns or small words like kyllä, ja, ei.
  classes: { n: true, v: true, a: true, u: true, q: false, b: false, c: false, i: false },
  plurals: false,
  styles: { k: true, s: true, r: true, d: true, m: true },
  banned: [],
};

export const CHOICES: { value: WordChoice; label: string; detail: string }[] = [
  { value: "any", label: "Any", detail: "Every word in the dictionary, however rare or long." },
  { value: "common", label: "Common", detail: "Words people actually use. Solves about as often as Any." },
  { value: "strict", label: "Strict", detail: "Only very common words. Some hands need a dump to fit." },
];

export const CLASSES: { value: WordClass; label: string; example: string }[] = [
  { value: "n", label: "Nouns", example: "talo, kissa" },
  { value: "v", label: "Verbs", example: "juosta, syödä" },
  { value: "a", label: "Adjectives", example: "iso, punainen" },
  { value: "u", label: "Numerals", example: "kolme, sata" },
  { value: "q", label: "Pronouns", example: "minä, se, joka" },
  { value: "b", label: "Adverbs", example: "kyllä, nyt, nopeasti" },
  { value: "c", label: "Conjunctions & prepositions", example: "ja, mutta, alla, ei" },
  { value: "i", label: "Interjections", example: "hei, joo, moi" },
];

/** Saved rules from before a class existed get that class's default. */
export function withDefaults(saved: Partial<Rules>): Rules {
  const classes = { ...DEFAULT_RULES.classes };
  for (const c of CLASSES) {
    const v = (saved.classes as Record<string, boolean> | undefined)?.[c.value];
    if (typeof v === "boolean") classes[c.value] = v;
  }
  return {
    ...DEFAULT_RULES,
    ...saved,
    classes,
    styles: { ...DEFAULT_RULES.styles, ...saved.styles },
  };
}

// A word with labels on every meaning (paku "ark.", nisti "slg.") is allowed
// if one of its meanings uses only allowed labels.
export const STYLES: { value: Style; label: string; example: string }[] = [
  { value: "k", label: "Colloquial", example: "paku, abi, isi" },
  { value: "s", label: "Slang", example: "nisti, jäbä, darra" },
  { value: "r", label: "Old & rare", example: "ajastaika, alinen" },
  { value: "d", label: "Derogatory", example: "akkamainen, diletantti" },
  { value: "m", label: "Dialect", example: "ehtoo, aatra" },
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
  // Always sent: older servers treat a missing field as "every class".
  wire.classes = CLASSES.filter((c) => r.classes[c.value])
    .map((c) => (c.value === "b" ? "bo" : c.value))
    .join("");
  const styles = { ...DEFAULT_RULES.styles, ...r.styles };
  if (!Object.values(styles).every(Boolean))
    wire.labels = (Object.keys(styles) as Style[]).filter((s) => styles[s]).join("");
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
  const isDefault = CLASSES.every((c) => r.classes[c.value] === DEFAULT_RULES.classes[c.value]);
  if (!isDefault) {
    const on = CLASSES.filter((c) => r.classes[c.value]);
    parts.push(on.length <= 3 ? on.map((c) => c.label.toLowerCase()).join(", ") + " only" : `${on.length} word types`);
  }
  const styles = { ...DEFAULT_RULES.styles, ...r.styles };
  const off = STYLES.filter((s) => !styles[s.value]);
  if (off.length) parts.push("no " + off.map((s) => s.label.toLowerCase()).join(", "));
  if (r.plurals) parts.push("plurals OK");
  if (r.banned.length) parts.push(`${r.banned.length} banned`);
  return parts.join(" · ");
}
