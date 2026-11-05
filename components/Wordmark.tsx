export function LogoMark({ className = "h-7 w-7" }: { className?: string }) {
  return (
    <svg viewBox="0 0 64 64" className={className} aria-hidden="true">
      <rect width="64" height="64" rx="16" fill="#12E27A" />
      <path d="M14 42 L26 30 L34 37 L50 20" fill="none" stroke="#04130B" strokeWidth="6" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M40 20 H50 V30" fill="none" stroke="#04130B" strokeWidth="6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function Wordmark({ className = "" }: { className?: string }) {
  return (
    <span className={`inline-flex items-center gap-2.5 ${className}`}>
      <LogoMark />
      <span className="text-[17px] font-extrabold tracking-[0.08em] text-ink">
        BIG<span className="text-brand">STOCKS</span>
      </span>
    </span>
  );
}
