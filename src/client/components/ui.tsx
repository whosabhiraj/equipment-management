import type { ReactNode } from 'react';

/**
 * Capacity pips — the signature element.
 *
 * A slot's remaining copies read as countable marks rather than a number, the
 * way racquets hang on hooks in the equipment room. Shape and count carry the
 * meaning; colour only reinforces it, so the grid stays readable to a
 * colourblind resident and at arm's length on a phone.
 *
 * Past eight copies, counting marks stops being faster than reading a number.
 */
export function Pips({ free, total }: { free: number; total: number }) {
  const label = `${free} of ${total} free`;

  if (total > 8) {
    return (
      <span className="font-mono text-xs font-semibold" aria-label={label}>
        {free}<span className="opacity-50">/{total}</span>
      </span>
    );
  }

  return (
    <span className="inline-flex items-center gap-[3px]" role="img" aria-label={label}>
      {Array.from({ length: total }, (_, i) => (
        <span key={i} className={`pip ${i < free ? 'pip-free' : 'pip-out'}`} />
      ))}
    </span>
  );
}

/**
 * Each equipment group gets a hue, assigned by position. Colour here is a
 * second handle on the taxonomy — you learn "board games are teal" and stop
 * reading the label — so it stays informational rather than decorative.
 */
export function categoryColor(index: number): string {
  return `var(--cat-${(index % 6) + 1})`;
}

export function CategoryDot({ index }: { index: number }) {
  return (
    <span
      aria-hidden
      className="inline-block h-2 w-2 flex-none rounded-sm"
      style={{ background: categoryColor(index) }}
    />
  );
}

/** A section heading. One per screen region, set off by a hairline, not a slab. */
export function SectionTitle({ children, action }: { children: ReactNode; action?: ReactNode }) {
  return (
    <div className="mb-3 flex items-center justify-between gap-3 border-b border-border pb-2">
      <h2 className="font-display text-sm font-semibold uppercase leading-none tracking-[0.1em]">
        {children}
      </h2>
      {action}
    </div>
  );
}

type Tone = 'neutral' | 'free' | 'requested' | 'taken' | 'accent';

const TONES: Record<Tone, string> = {
  neutral: 'border-border bg-secondary text-muted-foreground',
  // Settled states carry the app's own colour; the loudest thing on a row
  // should still be a problem, so this stays a fill rather than an outline.
  free: 'border-transparent bg-primary text-primary-foreground',
  requested: 'border-requested-border bg-requested-bg text-requested',
  taken: 'border-danger-border bg-danger-bg text-danger',
  accent: 'border-accent/40 bg-accent/10 text-accent',
};

export function Tag({ tone = 'neutral', children }: { tone?: Tone; children: ReactNode }) {
  return (
    <span
      className={`inline-flex items-center gap-1 whitespace-nowrap rounded-tag border px-1.5 py-[0.15rem] font-mono text-[0.7rem] font-medium uppercase tracking-wide ${TONES[tone]}`}
    >
      {children}
    </span>
  );
}

/** The one card shape in the app. */
export function Card({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <div className={`rounded-lg border border-border bg-card ${className}`}>{children}</div>;
}

/**
 * An empty state is an invitation to act, so it names the next move rather
 * than apologising for having nothing.
 */
export function Empty({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="rounded-lg border border-dashed border-rule px-5 py-10 text-center">
      <h3 className="font-display text-base font-semibold tracking-tight">{title}</h3>
      {children && (
        <p className="mx-auto mt-1.5 max-w-xs text-sm leading-relaxed text-muted-foreground">{children}</p>
      )}
    </div>
  );
}

export function Loading({ label }: { label: string }) {
  return (
    <p className="label-micro py-10 text-center">{label}</p>
  );
}

export function Notice({ tone, children }: { tone: 'free' | 'taken'; children: ReactNode }) {
  const styles =
    tone === 'free'
      ? 'border-free-border bg-free-bg text-free'
      : 'border-danger-border bg-danger-bg text-danger';
  return (
    <p role="status" className={`rounded-lg border px-3 py-2 text-sm leading-snug ${styles}`}>
      {children}
    </p>
  );
}

const BUTTON_BASE =
  'inline-flex items-center justify-center gap-1.5 rounded-lg font-medium tracking-tight transition-colors disabled:opacity-50 disabled:pointer-events-none';

const VARIANTS = {
  primary: 'bg-primary text-primary-foreground hover:opacity-85',
  brass: 'bg-accent text-accent-foreground hover:opacity-90',
  outline: 'border border-rule bg-card text-foreground hover:bg-secondary',
  danger: 'border border-danger-border bg-danger-bg text-danger hover:opacity-85',
  quiet: 'text-muted-foreground hover:text-foreground hover:bg-secondary',
} as const;

const SIZES = {
  sm: 'px-3 py-2 text-xs',
  md: 'px-3.5 py-2 text-sm',
  lg: 'px-4 py-2.5 text-base',
} as const;

type ButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: keyof typeof VARIANTS;
  size?: keyof typeof SIZES;
};

export function Button({ variant = 'primary', size = 'md', className = '', ...rest }: ButtonProps) {
  return <button className={`${BUTTON_BASE} ${VARIANTS[variant]} ${SIZES[size]} ${className}`} {...rest} />;
}

/** Inputs carry a real <label>; this keeps that pairing from drifting. */
export function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <label className="block space-y-1.5">
      <span className="label-micro block">{label}</span>
      {children}
      {hint && <span className="block text-xs text-muted-foreground">{hint}</span>}
    </label>
  );
}

export const inputClass =
  'w-full rounded-lg border border-rule bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground/60';
