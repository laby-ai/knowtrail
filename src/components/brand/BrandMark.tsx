import { publicAssetPath } from '@/lib/public-path';

type BrandMarkProps = {
  compact?: boolean;
  className?: string;
};

export function BrandMark({ compact = false, className = '' }: BrandMarkProps) {
  const size = compact ? 'h-10 w-10' : 'h-14 w-14';

  return (
    <span
      className={`inline-flex ${size} flex-shrink-0 items-center justify-center overflow-hidden rounded-full border border-slate-200 bg-white shadow-sm ${className}`}
      aria-hidden="true"
    >
      <img
        src={publicAssetPath('/assets/brand/lingbi-mark.svg')}
        alt=""
        className="h-full w-full object-cover"
      />
    </span>
  );
}
