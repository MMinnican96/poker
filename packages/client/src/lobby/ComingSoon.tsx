export interface ComingSoonProps {
  title: string;
  blurb?: string;
  icon?: string;
}

export function ComingSoon({ title, blurb, icon = '♠' }: ComingSoonProps) {
  return (
    <div className="mx-auto flex w-full max-w-[740px] flex-col items-center justify-center py-20 text-center">
      <div className="mb-5 flex h-16 w-16 items-center justify-center rounded-2xl border-[2.5px] border-gold-border bg-gold text-3xl text-[#2a1c00] shadow-hard-gold">
        {icon}
      </div>
      <h2 className="font-display text-[26px] font-semibold text-white">{title}</h2>
      <span className="mt-3 rounded-pill border-2 border-gold-border bg-gold px-3 py-1 text-xs font-extrabold text-[#2a1c00]">
        COMING SOON
      </span>
      <p className="mt-4 max-w-sm text-sm font-bold text-sage-muted">
        {blurb ?? 'This page is on the way. Check back soon!'}
      </p>
    </div>
  );
}
