import { Heart } from 'lucide-react';

export default function Footer() {
  return (
    <footer className="border-t border-border px-4 py-5">
      <p className="mx-auto flex max-w-5xl items-center justify-center gap-1.5 font-mono text-xs text-muted-foreground">
        Made with
        <Heart className="h-3 w-3 fill-accent text-accent" aria-label="love" />
        by Abhiraj
      </p>
    </footer>
  );
}
