import ThemeToggle from '../components/ThemeToggle';
import Footer from '../components/Footer';
import { Pips } from '../components/ui';

/**
 * A still of the real grid. It shows what the portal does in less time than a
 * paragraph would take to say it, which is why there is no such paragraph.
 */
const PREVIEW: { time: string; state: 'free' | 'low' | 'full' | 'yours' | 'asked' | 'shut' }[] = [
  { time: '18:00', state: 'free' },
  { time: '19:00', state: 'low' },
  { time: '20:00', state: 'full' },
  { time: '21:00', state: 'yours' },
  { time: '22:00', state: 'asked' },
  { time: '23:00', state: 'shut' },
];

function PreviewCell({ time, state }: (typeof PREVIEW)[number]) {
  const shell = 'flex min-h-[56px] flex-col justify-between rounded-lg border px-2 py-1.5';
  const stamp = 'font-mono text-[0.7rem] uppercase tracking-wide leading-none';

  const skin: Record<typeof state, string> = {
    free: 'border-border bg-card',
    low: 'border-border bg-card',
    yours: 'border-transparent bg-primary text-primary-foreground',
    asked: 'border-dashed border-requested-border bg-requested-bg text-requested',
    full: 'hatch-taken border-taken-border bg-taken-bg text-taken',
    shut: 'hatch-blackout border-blackout-border bg-blackout-bg text-blackout',
  };

  const mark: Record<typeof state, React.ReactNode> = {
    free: <Pips free={4} total={4} />,
    low: <Pips free={1} total={4} />,
    yours: <span className={stamp}>Yours</span>,
    asked: <span className={stamp}>Asked</span>,
    full: <span className={stamp}>Full</span>,
    shut: <span className={stamp}>Shut</span>,
  };

  return (
    <div className={`${shell} ${skin[state]}`}>
      <span className="font-mono text-sm font-semibold leading-none tracking-tight">{time}</span>
      <span className="leading-none">{mark[state]}</span>
    </div>
  );
}

const GoogleMark = () => (
  <svg className="h-4 w-4" viewBox="0 0 24 24" aria-hidden>
    <path
      fill="currentColor"
      d="M12.24 10.285V13.4h6.887c-.275 1.565-1.88 4.604-6.887 4.604-4.33 0-7.866-3.577-7.866-8s3.536-8 7.866-8c2.46 0 4.105 1.025 5.047 1.926l2.427-2.334C17.955 2.192 15.34 1 12.24 1 5.92 1 1 5.92 1 12s4.92 11 11.24 11c6.59 0 11-4.63 11-11.21 0-.756-.08-1.333-.18-1.905H12.24z"
    />
  </svg>
);

type LandingProps = {
  onSignIn: () => void;
  isSigningIn: boolean;
  error: string | null;
};

export default function Landing({ onSignIn, isSigningIn, error }: LandingProps) {
  return (
    <div className="flex min-h-screen flex-col">
      <header className="border-b border-border">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-4 py-2.5 sm:px-6">
          <span className="font-display text-sm font-semibold uppercase tracking-[0.12em]">
            Ram Bhavan
          </span>
          <ThemeToggle />
        </div>
      </header>

      <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col justify-center px-4 py-10 sm:px-6">
        <div className="grid items-center gap-10 lg:grid-cols-[1fr_1fr] lg:gap-16">
          <div>
            <p className="label-micro">Sports &amp; games inventory</p>

            <h1 className="mt-3 font-display text-[2.4rem] font-semibold leading-[1.03] tracking-[-0.03em] sm:text-[3.25rem]">
              All equipment,
              <br />
              hour by hour.
            </h1>

            <p className="mt-4 max-w-sm text-base leading-relaxed text-muted-foreground">
              Check what is free tonight, claim the hour, and let the sports rep
              confirm it. No group chat, no queue at the store room.
            </p>

            <div className="mt-8 max-w-sm space-y-3">
              {error && (
                <p
                  role="alert"
                  className="rounded-lg border border-taken-border bg-taken-bg px-3 py-2 text-sm leading-snug text-taken"
                >
                  {error}
                </p>
              )}

              <button
                onClick={onSignIn}
                disabled={isSigningIn}
                className="flex w-full items-center justify-center gap-2 rounded-lg bg-primary px-4 py-3 text-sm font-semibold tracking-tight text-primary-foreground transition-opacity hover:opacity-85 disabled:opacity-60"
              >
                <GoogleMark />
                {isSigningIn ? 'Taking you to Google…' : 'Sign in with Google'}
              </button>

              <p className="text-xs leading-relaxed text-muted-foreground">
                Use your college account. Only people from Ram Bhavan
                can sign in — if yours does not work, contact HSR.
              </p>
            </div>
          </div>

          {/* The grid is the product, so the page opens with it rather than with copy. */}
          <div className="rounded-xl border border-border bg-card p-4">
            <div className="mb-3 flex items-baseline justify-between border-b border-border pb-2">
              <p className="font-display text-sm font-semibold uppercase tracking-[0.1em]">
                Badminton racquet
              </p>
              <p className="label-micro">Tonight</p>
            </div>

            <div className="grid grid-cols-3 gap-1.5">
              {PREVIEW.map((cell) => (
                <PreviewCell key={cell.time} {...cell} />
              ))}
            </div>

            <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1.5 border-t border-border pt-2.5 font-mono text-[0.7rem] uppercase tracking-wide text-muted-foreground">
              <span className="inline-flex items-center gap-1.5">
                <Pips free={4} total={4} /> 4 free
              </span>
              <span className="inline-flex items-center gap-1.5">
                <Pips free={1} total={4} /> 1 left
              </span>
              <span className="inline-flex items-center gap-1.5">
                <span className="hatch-taken inline-block h-2.5 w-3.5 rounded-sm border border-taken-border" /> full
              </span>
            </div>
          </div>
        </div>
      </main>

      <Footer />
    </div>
  );
}
