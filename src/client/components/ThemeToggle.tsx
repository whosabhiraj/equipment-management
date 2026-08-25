import { useState } from 'react';
import { Moon, Sun } from 'lucide-react';

function currentIsDark(): boolean {
  return document.documentElement.classList.contains('dark');
}

export default function ThemeToggle() {
  const [isDark, setIsDark] = useState(currentIsDark);

  const toggle = () => {
    const next = !isDark;
    document.documentElement.classList.toggle('dark', next);
    try {
      localStorage.setItem('theme', next ? 'dark' : 'light');
    } catch {
      // Private browsing — the choice just won't survive a reload.
    }
    setIsDark(next);
  };

  return (
    <button
      onClick={toggle}
      className="rounded-lg p-2 text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
      aria-label={isDark ? 'Switch to light theme' : 'Switch to dark theme'}
    >
      {isDark ? <Sun className="h-[18px] w-[18px]" /> : <Moon className="h-[18px] w-[18px]" />}
    </button>
  );
}
