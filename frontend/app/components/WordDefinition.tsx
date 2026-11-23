"use client";

import { useEffect, useState } from "react";
import { define, type Definition, type DefinitionEntry, type DefinitionSense } from "../lib/api";

// ============================================================================
// What a word on the solved board means, from Kielitoimiston sanakirja. The
// server keeps every answer; this keeps them for the page too, so tapping a
// word again is instant.
// ============================================================================

const answers = new Map<string, Definition>();

/** Top-level meanings shown before "All meanings". */
const FIRST = 3;

type State =
  | { status: "loading" }
  | { status: "done"; definition: Definition }
  | { status: "error"; message: string };

export function WordDefinition({ word }: { word: string }) {
  const key = word.toLowerCase();
  const [state, setState] = useState<State & { key: string }>(() => initial(key));
  const [attempt, setAttempt] = useState(0);
  const current = state.key === key ? state : initial(key);

  // A word without an answer yet shows as loading (see `current`), so the
  // effect only has to fetch.
  useEffect(() => {
    if (answers.has(key)) return;
    const ctrl = new AbortController();
    define(key, ctrl.signal)
      .then((definition) => {
        answers.set(key, definition);
        setState({ key, status: "done", definition });
      })
      .catch((e: Error) => {
        if (!ctrl.signal.aborted) setState({ key, status: "error", message: e.message });
      });
    return () => ctrl.abort();
  }, [key, attempt]);

  return (
    <section className="define" aria-live="polite">
      {current.status === "loading" && (
        <p className="define-loading hint">
          <span className="define-spinner" aria-hidden /> Looking up {key}
        </p>
      )}
      {current.status === "error" && (
        <p className="hint">
          {current.message}{" "}
          <button
            type="button"
            className="link-btn"
            onClick={() => {
              setState({ key, status: "loading" });
              setAttempt((n) => n + 1);
            }}
          >
            Retry
          </button>
        </p>
      )}
      {current.status === "done" &&
        (current.definition.found ? (
          <div className="stack">
            {current.definition.entries.map((e, i) => (
              <Entry key={`${key}-${i}`} word={key} entry={e} />
            ))}
          </div>
        ) : (
          <p className="hint">
            <strong className="define-missing">{key}</strong> is not in the dictionary as its own word.
          </p>
        ))}
      {current.status !== "loading" && (
        <a
          className="define-source"
          href={`https://www.kielitoimistonsanakirja.fi/#/${encodeURIComponent(key)}`}
          target="_blank"
          rel="noreferrer"
        >
          Kielitoimiston sanakirja
        </a>
      )}
    </section>
  );
}

function initial(key: string): State & { key: string } {
  const definition = answers.get(key);
  return definition ? { key, status: "done", definition } : { key, status: "loading" };
}

function Entry({ word, entry }: { word: string; entry: DefinitionEntry }) {
  const [all, setAll] = useState(false);
  const senses = all ? entry.senses : entry.senses.slice(0, FIRST);
  const hidden = entry.senses.length - senses.length;
  return (
    <div className="define-entry">
      <p className="define-head">
        <span className="define-word">
          {word}
          {entry.homonym > 0 && <sup>{entry.homonym}</sup>}
        </span>
        {entry.pos && <span className="define-pos">{entry.pos}</span>}
        <Labels labels={entry.labels} />
      </p>
      {entry.text && <p className="define-text">{entry.text}</p>}
      <Examples examples={entry.examples} />
      {senses.length > 0 && (
        <ol className="define-senses">
          {senses.map((s, i) => (
            <Sense key={i} sense={s} />
          ))}
        </ol>
      )}
      {hidden > 0 && (
        <button type="button" className="link-btn define-more" onClick={() => setAll(true)}>
          {hidden === 1 ? "1 more meaning" : `${hidden} more meanings`}
        </button>
      )}
    </div>
  );
}

function Sense({ sense }: { sense: DefinitionSense }) {
  return (
    <li className="define-sense">
      {sense.num && <span className="define-num">{sense.num}</span>}
      <div className="define-body">
        <p className="define-text">
          {sense.pos && <span className="define-pos">{sense.pos}</span>}
          <Labels labels={sense.labels} />
          {sense.text}
        </p>
        <Examples examples={sense.examples} />
        {sense.senses && sense.senses.length > 0 && (
          <ol className="define-senses">
            {sense.senses.map((s, i) => (
              <Sense key={i} sense={s} />
            ))}
          </ol>
        )}
      </div>
    </li>
  );
}

function Labels({ labels }: { labels?: string[] }) {
  if (!labels?.length) return null;
  return (
    <>
      {labels.map((l) => (
        <span key={l} className="define-label">
          {l}
        </span>
      ))}
    </>
  );
}

function Examples({ examples }: { examples?: string[] }) {
  if (!examples?.length) return null;
  return <p className="define-examples">{examples.join(" ")}</p>;
}
