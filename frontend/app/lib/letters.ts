// The Finnish tile set: the letters the detector knows and the solver's
// word list is written in.
export const ALPHABET = "abdeghijklmnoprstuvyäö".split("");
const VOWELS = new Set("aeiouyäö".split(""));

// Alphabetical in Finnish order (ä and ö after z), so a hand reads the way
// you would sort the tiles in front of you.
export function sortLetters(letters: string[]): string[] {
  return [...letters].sort((a, b) => a.localeCompare(b, "fi"));
}

// Rough Finnish letter frequency, commonest first. Used to guess which tile
// is hardest to place when no single dump makes the rest fit.
const FREQUENCY = "aitnesloukämvrjhypdögb";

export function isVowel(letter: string) {
  return VOWELS.has(letter);
}

// Higher = more awkward to place. Rare letters score high, and so does
// whichever kind of letter (vowel or consonant) the hand has too many of.
export function awkwardness(letter: string, hand: string[]): number {
  const rank = FREQUENCY.indexOf(letter);
  const rarity = rank < 0 ? FREQUENCY.length : rank;
  const vowels = hand.filter(isVowel).length;
  const share = hand.length ? vowels / hand.length : 0.5;
  // Finnish text runs at about half vowels.
  const imbalance = isVowel(letter) ? share - 0.5 : 0.5 - share;
  return rarity + imbalance * 20;
}

export function removeOne(letters: string[], letter: string): string[] {
  const i = letters.indexOf(letter);
  return i < 0 ? letters : [...letters.slice(0, i), ...letters.slice(i + 1)];
}
