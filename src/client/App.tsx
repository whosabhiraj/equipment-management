import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { CalendarCheck, ClipboardList, LogOut, Settings2 } from 'lucide-react';
import ThemeToggle from './components/ThemeToggle';
import Contacts from './components/Contacts';
import Landing from './views/Landing';
import BrowseView from './views/BrowseView';
import MyBookingsView from './views/MyBookingsView';
import ManageView, { type ManageTab } from './views/ManageView';

type ClientUser = {
  id: string;
  email: string;
  name: string;
  role: 'resident' | 'rep' | 'admin';
  roomNo: string | null;
  disabled: boolean;
};

/**
 * Better Auth returns its rejection reasons as underscored slugs on the
 * callback URL. Every message here says what happened and who can fix it.
 */
const SIGN_IN_ERRORS: Record<string, string> = {
  unable_to_create_user:
    "You haven't been added to the hostel yet, so you can't get in. Contact the admin to be added.",
  account_not_linked:
    'That Google account could not be linked. Your college email has to be verified with Google first.',
  unable_to_link_account:
    'Could not connect your Google account. This one is on the server, not you — send the admin this code: unable_to_link_account.',
  unable_to_create_session: 'Google signed you in but the session did not stick. Try again.',
  email_not_found: 'Google did not share an email address for that account.',
  email_not_verified: 'Your Google email address is not verified.',
  unable_to_get_user_info: 'Google did not return your profile. Try again.',
  please_restart_the_process: 'That sign-in attempt expired. Try again.',
  state_not_found: 'That sign-in attempt expired. Try again.',
  invalid_callback_request: 'That sign-in attempt expired. Try again.',
};

type Tab = 'book' | 'bookings' | 'manage';

export default function App() {
  const queryClient = useQueryClient();
  const [tab, setTab] = useState<Tab>('book');
  const [selectedItemId, setSelectedItemId] = useState<string | null>(null);
  const [manageTab, setManageTab] = useState<ManageTab>('queue');
  const [isSigningIn, setIsSigningIn] = useState(false);
  const [loginError, setLoginError] = useState<string | null>(() => {
    const code = new URLSearchParams(window.location.search).get('error');
    if (!code) return null;
    // Always surface the raw code for anything unmapped — a bare "ask someone
    // else" leaves nobody with anything to act on.
    return SIGN_IN_ERRORS[code] ?? `Sign-in was rejected (${code}). Send the admin that code.`;
  });

  const { data: me, isLoading } = useQuery<{ authenticated: boolean; user: ClientUser | null }>({
    queryKey: ['me'],
    queryFn: async () => {
      const res = await fetch('/api/me');
      if (res.status === 401) return { authenticated: false, user: null };
      if (!res.ok) throw new Error('Auth fetch error');
      return res.json();
    },
  });

  // Better Auth has no GET redirect endpoint: POST to /sign-in/social and it
  // hands back the Google authorization URL to navigate to.
  const handleLogin = async () => {
    setLoginError(null);
    setIsSigningIn(true);
    try {
      const res = await fetch('/api/auth/sign-in/social', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          provider: 'google',
          callbackURL: window.location.origin,
          errorCallbackURL: window.location.origin,
        }),
      });
      const data = (await res.json().catch(() => null)) as { url?: string; message?: string } | null;

      if (!res.ok || !data?.url) {
        setLoginError(data?.message ?? 'Sign-in could not be started. Try again, or contact the admin.');
        setIsSigningIn(false);
        return;
      }
      window.location.href = data.url;
    } catch {
      setLoginError('Could not reach the server. Check your connection and try again.');
      setIsSigningIn(false);
    }
  };

  const handleLogout = async () => {
    await fetch('/api/auth/sign-out', { method: 'POST' });
    queryClient.invalidateQueries({ queryKey: ['me'] });
    window.location.href = '/';
  };

  if (isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <p className="font-mono text-xs uppercase tracking-[0.2em] text-muted-foreground">Loading</p>
      </div>
    );
  }

  const currentUser = me?.user;
  if (!me?.authenticated || !currentUser) {
    return <Landing onSignIn={handleLogin} isSigningIn={isSigningIn} error={loginError} />;
  }

  const canManage = currentUser.role === 'rep' || currentUser.role === 'admin';
  const tabs: { id: Tab; label: string; Icon: typeof CalendarCheck }[] = [
    { id: 'book', label: 'Book', Icon: CalendarCheck },
    { id: 'bookings', label: 'Mine', Icon: ClipboardList },
    ...(canManage ? [{ id: 'manage' as Tab, label: 'Manage', Icon: Settings2 }] : []),
  ];

  return (
    <div className="flex min-h-screen flex-col">
      <header className="sticky top-0 z-20 border-b border-border bg-background/95 backdrop-blur">
        <div className="mx-auto flex max-w-5xl items-center justify-between gap-3 px-4 py-3">
          <div className="min-w-0">
            <p className="font-display text-sm font-semibold uppercase leading-none tracking-[0.12em]">
              Ram Bhavan
            </p>
            <p className="label-micro mt-1 truncate">
              {currentUser.name}
              {currentUser.roomNo && ` · ${currentUser.roomNo}`}
              {currentUser.role !== 'resident' && ` · ${currentUser.role}`}
            </p>
          </div>

          <div className="flex flex-none items-center gap-0.5">
            {/* Desktop keeps the tabs up here; phones get them at thumb height. */}
            <nav className="mr-2 hidden gap-0.5 sm:flex">
              {tabs.map(({ id, label }) => (
                <button
                  key={id}
                  onClick={() => setTab(id)}
                  aria-current={tab === id ? 'page' : undefined}
                  className={`rounded-lg px-3 py-1.5 text-sm font-medium tracking-tight transition-colors ${
                    tab === id
                      ? 'bg-secondary text-foreground'
                      : 'text-muted-foreground hover:text-foreground'
                  }`}
                >
                  {label}
                </button>
              ))}
            </nav>
            <ThemeToggle />
            <button
              onClick={handleLogout}
              className="rounded-lg p-2 text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
              aria-label="Sign out"
            >
              <LogOut className="h-[18px] w-[18px]" />
            </button>
          </div>
        </div>
      </header>

      <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-4 sm:py-6">
        {tab === 'book' && (
          <BrowseView selectedItemId={selectedItemId} setSelectedItemId={setSelectedItemId} />
        )}
        {tab === 'bookings' && <MyBookingsView />}
        {tab === 'manage' && canManage && (
          <ManageView tab={manageTab} setTab={setManageTab} isAdmin={currentUser.role === 'admin'} />
        )}
        <Contacts className="mt-10 border-t border-border pt-6" />
      </main>

      {/* Clears the fixed bottom bar. A margin utility would collide with the
          sm: override, so the space is an element. */}
      <div className="h-16 sm:hidden" aria-hidden />

      {/* Bottom bar: the resident is standing in a corridor holding a phone in
          one hand, so the three things they do live inside thumb reach. */}
      <nav
        aria-label="Sections"
        className="fixed inset-x-0 bottom-0 z-20 grid grid-flow-col border-t border-border bg-background/95 pb-safe backdrop-blur sm:hidden"
      >
        {tabs.map(({ id, label, Icon }) => (
          <button
            key={id}
            onClick={() => setTab(id)}
            aria-current={tab === id ? 'page' : undefined}
            className={`flex flex-col items-center gap-0.5 py-2 transition-colors ${
              tab === id ? 'text-primary' : 'text-muted-foreground'
            }`}
          >
            <Icon className="h-5 w-5" strokeWidth={tab === id ? 2.4 : 1.8} />
            <span className="font-mono text-[0.65rem] uppercase tracking-[0.1em]">{label}</span>
          </button>
        ))}
      </nav>
    </div>
  );
}
