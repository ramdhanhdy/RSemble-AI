import { BRAND_DEFAULT, brandForSlug, type BrandIconKey } from "../studio-data";

export function HexCubeLogo({
  size = 22,
  className,
}: {
  size?: number;
  className?: string;
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.6}
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      <path d="M12 2.5 20.5 7.25v9.5L12 21.5 3.5 16.75v-9.5L12 2.5Z" />
      <path d="M12 12 20.5 7.25M12 12v9.5M12 12 3.5 7.25" />
    </svg>
  );
}

function GlmMark({ size }: { size: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M6 5.5h12L6 18.5h12" />
    </svg>
  );
}

function MiniMaxMark({ size }: { size: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M7 7.5l4 4-4 4M17 7.5l-4 4 4 4" />
    </svg>
  );
}

function DeepSeekMark({ size }: { size: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M5 7l7 4.5L19 7M5 12.5l7 4.5 7-4.5" />
    </svg>
  );
}

function GenericMark({ size }: { size: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinejoin="round" aria-hidden="true">
      <rect x="4.5" y="4.5" width="6.5" height="6.5" rx="1.5" />
      <rect x="13" y="4.5" width="6.5" height="6.5" rx="1.5" />
      <rect x="4.5" y="13" width="6.5" height="6.5" rx="1.5" />
      <rect x="13" y="13" width="6.5" height="6.5" rx="1.5" />
    </svg>
  );
}

const MARKS: Record<BrandIconKey, ({ size }: { size: number }) => React.JSX.Element> = {
  glm: GlmMark,
  minimax: MiniMaxMark,
  deepseek: DeepSeekMark,
  generic: GenericMark,
};

export function BrandAvatar({
  slug,
  size = 32,
  className,
}: {
  slug: string;
  size?: number;
  className?: string;
}) {
  const brand = brandForSlug(slug);
  const Mark = MARKS[brand.icon] ?? MARKS[BRAND_DEFAULT.icon];
  return (
    <span
      className={`flex shrink-0 items-center justify-center rounded-sm text-white ${className ?? ""}`}
      style={{ width: size, height: size, backgroundColor: brand.brandColor }}
      aria-hidden="true"
    >
      <Mark size={Math.round(size * 0.62)} />
    </span>
  );
}
