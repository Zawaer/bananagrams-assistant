import type { CSSProperties, ReactNode } from "react";

type Props = {
  letter?: string;
  size?: number;
  selected?: boolean;
  /** Read with low confidence: worth checking against the real tile. */
  doubtful?: boolean;
  /** Suggested by the dump helper. */
  highlight?: boolean;
  onClick?: () => void;
  label?: string;
  style?: CSSProperties;
  className?: string;
  children?: ReactNode;
};

export function Tile({
  letter,
  size = 44,
  selected,
  doubtful,
  highlight,
  onClick,
  label,
  style,
  className = "",
  children,
}: Props) {
  const small = size < 22;
  const classes = [
    "tile",
    selected && "tile-selected",
    highlight && "tile-highlight",
    onClick && "tile-button",
    className,
  ]
    .filter(Boolean)
    .join(" ");
  const css: CSSProperties = {
    width: size,
    height: size,
    fontSize: Math.max(8, Math.round(size * 0.5)),
    borderRadius: small ? 3 : Math.round(size * 0.16),
    ...style,
  };
  const content = (
    <>
      {children ?? letter?.toUpperCase()}
      {doubtful && <span className="tile-dot" aria-hidden />}
    </>
  );
  if (!onClick)
    return (
      <div className={classes} style={css}>
        {content}
      </div>
    );
  return (
    <button
      type="button"
      className={classes}
      style={css}
      onClick={onClick}
      aria-label={label ?? `Tile ${letter?.toUpperCase()}`}
      aria-pressed={selected}
    >
      {content}
    </button>
  );
}
