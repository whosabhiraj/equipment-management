import { useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import AvailabilityGrid from '../components/AvailabilityGrid';
import { CategoryDot, Empty, Loading, Pips, Tag, categoryColor } from '../components/ui';

type CatalogItem = {
  id: string;
  name: string;
  description: string | null;
  quantity: number;
  requiresApproval: boolean;
  maxSlotsPerBooking: number;
};

type CategoryWithItems = {
  id: string;
  name: string;
  sortOrder: number;
  items: CatalogItem[];
};

type BrowseViewProps = {
  selectedItemId: string | null;
  setSelectedItemId: (id: string | null) => void;
};

export default function BrowseView({ selectedItemId, setSelectedItemId }: BrowseViewProps) {
  const { data: categories, isLoading } = useQuery<CategoryWithItems[]>({
    queryKey: ['catalog'],
    queryFn: async () => {
      const res = await fetch('/api/items');
      if (!res.ok) throw new Error('Catalog fetch error');
      return res.json();
    },
  });

  // Opening an item is a navigation, so the phone's back gesture should undo
  // it rather than leaving the app.
  useEffect(() => {
    const onPop = () => setSelectedItemId(null);
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, [setSelectedItemId]);

  const openItem = (id: string) => {
    window.history.pushState({ item: id }, '');
    setSelectedItemId(id);
  };

  const closeItem = () => {
    if (window.history.state?.item) {
      window.history.back();
    } else {
      setSelectedItemId(null);
    }
  };

  if (isLoading) return <Loading label="Loading equipment" />;

  if (!categories || categories.length === 0) {
    return (
      <Empty title="Nothing in the store room yet">
        Your sports rep adds racquets, boards and balls from the manage screen. Check
        back once they have.
      </Empty>
    );
  }

  const selectedItem = categories.flatMap((c) => c.items).find((i) => i.id === selectedItemId);
  const selectedCategoryIndex = categories.findIndex((c) =>
    c.items.some((i) => i.id === selectedItemId)
  );

  // --- Slots for one item ---
  if (selectedItem) {
    return (
      <div>
        <button
          onClick={closeItem}
          className="-ml-1.5 mb-3 inline-flex items-center gap-1 rounded-lg px-1.5 py-1 text-sm text-muted-foreground transition-colors hover:text-foreground"
        >
          <ChevronLeft className="h-4 w-4" />
          All equipment
        </button>

        <div className="mb-4">
          <div className="flex flex-wrap items-center gap-2">
            <span
              aria-hidden
              className="h-4 w-1 flex-none rounded-sm"
              style={{ background: categoryColor(Math.max(0, selectedCategoryIndex)) }}
            />
            <h2 className="font-display text-xl font-semibold leading-none tracking-[-0.01em]">
              {selectedItem.name}
            </h2>
            {selectedItem.requiresApproval ? (
              <Tag tone="requested">Rep approves</Tag>
            ) : (
              <Tag tone="free">Books instantly</Tag>
            )}
          </div>
          {selectedItem.description && (
            <p className="mt-2 max-w-prose text-sm leading-relaxed text-muted-foreground">
              {selectedItem.description}
            </p>
          )}
        </div>

        <AvailabilityGrid key={selectedItem.id} itemId={selectedItem.id} />
      </div>
    );
  }

  // --- The catalogue. This is what the Book tab is for; slots are one tap in. ---
  return (
    <div className="space-y-7">
      {categories.map((cat, catIndex) => (
        <section key={cat.id}>
          <h2 className="label-micro mb-2.5 flex items-center gap-1.5">
            <CategoryDot index={catIndex} />
            {cat.name}
          </h2>

          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {cat.items.map((item) => (
              <button
                key={item.id}
                onClick={() => openItem(item.id)}
                style={{ borderLeftColor: categoryColor(catIndex) }}
                className="group flex items-center gap-3 rounded-lg border border-l-[3px] border-border bg-card px-3.5 py-3 text-left transition-colors hover:border-rule hover:bg-secondary"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                    <span className="font-display text-base font-semibold leading-tight tracking-tight">
                      {item.name}
                    </span>
                    {!item.requiresApproval && <Tag tone="free">Instant</Tag>}
                  </div>

                  {item.description && (
                    <p className="mt-1 line-clamp-2 text-sm leading-snug text-muted-foreground">
                      {item.description}
                    </p>
                  )}

                  <div className="mt-2 flex items-center gap-2">
                    <Pips free={item.quantity} total={item.quantity} />
                    <span className="font-mono text-xs text-muted-foreground">
                      {item.quantity} in stock · up to {item.maxSlotsPerBooking}h
                    </span>
                  </div>
                </div>

                <ChevronRight className="h-4 w-4 flex-none text-muted-foreground transition-transform group-hover:translate-x-0.5" />
              </button>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
