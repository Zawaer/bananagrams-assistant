import { ALPHABET } from "../lib/letters";

// An on-screen tile keyboard: faster than the phone keyboard for single
// letters, and it can only produce letters that exist in the set.
export function LetterPad({ onPick }: { onPick: (letter: string) => void }) {
  return (
    <div className="letter-pad">
      {ALPHABET.map((l) => (
        <button key={l} type="button" className="pad-key" onClick={() => onPick(l)}>
          {l.toUpperCase()}
        </button>
      ))}
    </div>
  );
}
