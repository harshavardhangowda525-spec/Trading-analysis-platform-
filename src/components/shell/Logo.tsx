import { useId } from "react";

export function Logo({ compact = false }: { compact?: boolean }) {
  const id = useId().replace(/:/g, "");
  return (
    <span className="inline-flex items-center gap-2.5">
      <svg width="28" height="28" viewBox="0 0 32 32" aria-hidden>
        <defs>
          <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#f4e7cc" />
            <stop offset="0.5" stopColor="#d6b77d" />
            <stop offset="1" stopColor="#8a6b42" />
          </linearGradient>
        </defs>
        <rect x="1" y="1" width="30" height="30" rx="9" fill="#0d0f14" stroke={`url(#${id})`} strokeOpacity="0.6" />
        <path d="M7 20.5 12.5 14l4 3.5L25 9" fill="none" stroke={`url(#${id})`} strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
        <circle cx="25" cy="9" r="2" fill="#7cc4ff" />
      </svg>
      {!compact && (
        <span className="text-[15px] font-extrabold tracking-[0.22em]">
          <span className="metal-text">TRADE</span>
          <span className="text-text">OS</span>
        </span>
      )}
    </span>
  );
}
