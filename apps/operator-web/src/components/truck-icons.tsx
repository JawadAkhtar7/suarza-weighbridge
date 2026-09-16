/**
 * An empty truck and a loaded one.
 *
 * Drawn here rather than taken from lucide, which has a truck but no pair that
 * reads as empty versus loaded — and that contrast is the entire point: it is
 * what tells an operator at a glance which half of the job they are on, without
 * reading a word.
 *
 * Both are on lucide's 24×24 grid with its stroke conventions (2px, round caps
 * and joins, `currentColor`), so they size and colour exactly like every other
 * icon on the screen. They share one silhouette — same deck, same cab, same
 * wheels — so the only thing that changes between them is the load.
 */

interface IconProps {
  className?: string;
}

const COMMON = {
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 2,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
} as const;

/**
 * The shared silhouette: an open-topped deck, a cab, two wheels.
 *
 * Open at the TOP — the walls and the floor are drawn, the top edge is not —
 * so the deck is something a load can sit in rather than a sealed van.
 */
function Body() {
  return (
    <>
      <path d="M2 9v6h11V9" />
      <path d="M13 11.5h3.8l3.2 3.5V15H13" />
      <circle cx="6.5" cy="17.5" r="2" />
      <circle cx="17" cy="17.5" r="2" />
    </>
  );
}

/** An empty deck: the truck as it arrives to be weighed. */
export function EmptyTruckIcon({ className }: IconProps) {
  return (
    <svg {...COMMON} className={className} aria-hidden="true">
      <Body />
    </svg>
  );
}

/** The same truck carrying a load: what comes back for the second weight. */
export function LoadedTruckIcon({ className }: IconProps) {
  return (
    <svg {...COMMON} className={className} aria-hidden="true">
      <Body />
      {/*
       * The load is SOLID, not another outline.
       *
       * At 28 pixels an outlined box inside an outlined deck is just more
       * lines; a filled mass reads as "full" instantly and from a distance,
       * which is the whole job of the pair. It heaps slightly above the walls
       * the way a real load sits.
       */}
      <path
        d="M3.4 10.4h8.2v3.4H3.4z"
        fill="currentColor"
        stroke="currentColor"
        strokeWidth={1}
      />
      <path d="M3.6 10.4 6 7.9l2.4 2.5L10 8.8l1.6 1.6" />
    </svg>
  );
}
