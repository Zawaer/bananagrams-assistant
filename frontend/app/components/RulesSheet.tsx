"use client";

import {
  CHOICES,
  CLASSES,
  MAX_LEN,
  MIN_LEN,
  type Rules,
  type WordClass,
} from "../lib/rules";
import { Sheet } from "./Sheet";

// House rules. Every change applies to the next solve; on the result screen
// closing the sheet re-solves the hand.
export function RulesSheet({
  open,
  rules,
  onChange,
  onClose,
}: {
  open: boolean;
  rules: Rules;
  onChange: (r: Rules) => void;
  onClose: () => void;
}) {
  const set = (patch: Partial<Rules>) => onChange({ ...rules, ...patch });
  const choice = CHOICES.find((c) => c.value === rules.choice)!;
  const onCount = Object.values(rules.classes).filter(Boolean).length;

  const setMin = (n: number) => {
    const minLen = Math.max(MIN_LEN, Math.min(MAX_LEN, n));
    set({ minLen, maxLen: rules.maxLen != null ? Math.max(minLen, rules.maxLen) : null });
  };
  const setMax = (n: number | null) => {
    if (n == null || n > MAX_LEN) return set({ maxLen: null });
    const maxLen = Math.max(MIN_LEN, n);
    set({ maxLen, minLen: Math.min(rules.minLen, maxLen) });
  };

  return (
    <Sheet open={open} onClose={onClose} title="House rules">
      <div className="stack-lg">
        <section className="stack-sm">
          <div className="label">Words</div>
          <div className="segmented segmented-3">
            {CHOICES.map((c) => (
              <button
                key={c.value}
                type="button"
                className={rules.choice === c.value ? "seg seg-on" : "seg"}
                onClick={() => set({ choice: c.value })}
              >
                {c.label}
              </button>
            ))}
          </div>
          <p className="hint">{choice.detail}</p>
        </section>

        <section className="stack-sm">
          <div className="label">Word length</div>
          <div className="row">
            <Stepper
              label="Shortest"
              value={String(rules.minLen)}
              onMinus={() => setMin(rules.minLen - 1)}
              onPlus={() => setMin(rules.minLen + 1)}
              minusDisabled={rules.minLen <= MIN_LEN}
              plusDisabled={rules.minLen >= MAX_LEN}
            />
            <Stepper
              label="Longest"
              value={rules.maxLen == null ? "Any" : String(rules.maxLen)}
              onMinus={() => setMax(rules.maxLen == null ? 12 : rules.maxLen - 1)}
              onPlus={() => setMax(rules.maxLen == null ? null : rules.maxLen + 1)}
              minusDisabled={rules.maxLen != null && rules.maxLen <= MIN_LEN}
              plusDisabled={rules.maxLen == null}
            />
          </div>
          <div className="chips">
            {[
              { label: "Any length", min: MIN_LEN, max: null },
              { label: "Exactly 4", min: 4, max: 4 },
              { label: "6 or more", min: 6, max: null },
              { label: "Up to 7", min: MIN_LEN, max: 7 },
            ].map((p) => (
              <button
                key={p.label}
                type="button"
                className={rules.minLen === p.min && rules.maxLen === p.max ? "chip-btn chip-on" : "chip-btn"}
                onClick={() => set({ minLen: p.min, maxLen: p.max })}
              >
                {p.label}
              </button>
            ))}
          </div>
        </section>

        <section className="stack-sm">
          <div className="label">Word types</div>
          <div className="chips">
            {CLASSES.map((c) => {
              const on = rules.classes[c.value];
              return (
                <button
                  key={c.value}
                  type="button"
                  className={on ? "chip-btn chip-on" : "chip-btn"}
                  aria-pressed={on}
                  // Keep at least one type on, or nothing could ever fit.
                  disabled={on && onCount === 1}
                  onClick={() =>
                    set({ classes: { ...rules.classes, [c.value]: !on } as Record<WordClass, boolean> })
                  }
                >
                  {c.label}
                </button>
              );
            })}
          </div>
          <p className="hint">Other: numerals and the odd adverb.</p>
        </section>

        <button
          type="button"
          role="switch"
          aria-checked={rules.plurals}
          className="toggle-row"
          onClick={() => set({ plurals: !rules.plurals })}
        >
          <span className="stack-sm">
            <span className="strong">Plurals</span>
            <span className="hint">Plural-only words like housut, häät, hautajaiset.</span>
          </span>
          <span className={rules.plurals ? "switch switch-on" : "switch"} aria-hidden>
            <span className="switch-knob" />
          </span>
        </button>

        <section className="stack-sm">
          <div className="label">Banned words · {rules.banned.length}</div>
          {rules.banned.length === 0 ? (
            <p className="hint">Tap a word on a solved board to ban it.</p>
          ) : (
            <div className="ban-list">
              {rules.banned.map((b) => (
                <div key={b.word} className="ban-row">
                  <div className="stack-sm">
                    <span className="ban-word">{b.word.toUpperCase()}</span>
                    {b.reason && <span className="hint">{b.reason}</span>}
                  </div>
                  <button
                    type="button"
                    className="ghost-btn"
                    onClick={() => set({ banned: rules.banned.filter((x) => x.word !== b.word) })}
                  >
                    Unban
                  </button>
                </div>
              ))}
            </div>
          )}
        </section>

        <button type="button" className="btn btn-primary" onClick={onClose}>
          Done
        </button>
      </div>
    </Sheet>
  );
}

function Stepper({
  label,
  value,
  onMinus,
  onPlus,
  minusDisabled,
  plusDisabled,
}: {
  label: string;
  value: string;
  onMinus: () => void;
  onPlus: () => void;
  minusDisabled?: boolean;
  plusDisabled?: boolean;
}) {
  return (
    <div className="stepper">
      <span className="hint">{label}</span>
      <div className="stepper-row">
        <button type="button" className="step-btn" onClick={onMinus} disabled={minusDisabled} aria-label={`${label} shorter`}>
          −
        </button>
        <span className="step-value">{value}</span>
        <button type="button" className="step-btn" onClick={onPlus} disabled={plusDisabled} aria-label={`${label} longer`}>
          +
        </button>
      </div>
    </div>
  );
}
