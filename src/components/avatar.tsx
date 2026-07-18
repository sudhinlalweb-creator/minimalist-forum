import BoringAvatar from "boring-avatars";

/**
 * Generated identity marks (boring-avatars), seeded by username so the same
 * person renders the same mark everywhere without storing or hosting an image.
 *
 * Two deliberate choices:
 *
 * The palette is passed as CSS custom properties rather than literal hex.
 * boring-avatars writes `colors` straight into SVG `fill` attributes without
 * parsing them, so `var(--avatar-3)` resolves in the browser and follows the
 * theme. A literal palette is baked at render time and could only ever match
 * one theme — these are server-rendered, so there is no second chance to
 * correct it on the client.
 *
 * `square` is on because the design uses rounded squares, not circles; the
 * library's default is a full circle. The radius comes from the token scale
 * via rounded-md, matching every other avatar-sized surface.
 */
const AVATAR_PALETTE = [
  "var(--avatar-1)",
  "var(--avatar-2)",
  "var(--avatar-3)",
  "var(--avatar-4)",
  "var(--avatar-5)",
];

export function Avatar({
  /** Seed. Username rather than display name: it is unique and stable, so the mark survives a rename. */
  name,
  size,
  className = "",
}: {
  name: string;
  size: number;
  className?: string;
}) {
  return (
    <BoringAvatar
      name={name}
      variant="bauhaus"
      size={size}
      square
      colors={AVATAR_PALETTE}
      className={`rounded-md ${className}`}
    />
  );
}
