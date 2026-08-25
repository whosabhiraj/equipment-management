import { useQuery } from '@tanstack/react-query';
import AvailabilityGrid from '../components/AvailabilityGrid';
import { CategoryDot, Empty, Loading, Tag, categoryColor } from '../components/ui';

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

  if (isLoading) return <Loading label="Loading equipment" />;

  if (!categories || categories.length === 0) {
    return (
      <Empty title="Nothing in the store room yet">
        Your sports rep adds racquets, boards and balls from the manage screen. Check
        back once they have.
      </Empty>
    );
  }

  const allItems = categories.flatMap((c) => c.items);
  const selectedItem = allItems.find((i) => i.id === selectedItemId) ?? allItems[0];

  if (!selectedItem) {
    return (
      <Empty title="Nothing in the store room yet">
        Your sports rep adds racquets, boards and balls from the manage screen.
      </Empty>
    );
  }

  return (
    <div className="lg:grid lg:grid-cols-[15rem_1fr] lg:items-start lg:gap-6">
      {/*
        On a phone this is a horizontal rail rather than a stacked list: a full
        catalogue sidebar would push the grid — the thing you came for — a whole
        screen down.
      */}
      <nav
        aria-label="Equipment"
        className="-mx-4 mb-4 flex gap-1.5 overflow-x-auto px-4 pb-1 scrollbar-none lg:mx-0 lg:mb-0 lg:flex-col lg:overflow-visible lg:px-0"
      >
        {categories.map((cat, catIndex) => (
          <div key={cat.id} className="contents lg:block lg:space-y-1 lg:pb-3">
            <p className="label-micro hidden items-center gap-1.5 lg:flex lg:pb-1">
              <CategoryDot index={catIndex} />
              {cat.name}
            </p>
            {cat.items.map((item) => {
              const isSelected = selectedItem.id === item.id;
              return (
                <button
                  key={item.id}
                  onClick={() => setSelectedItemId(item.id)}
                  aria-pressed={isSelected}
                  style={isSelected ? undefined : { borderLeftColor: categoryColor(catIndex) }}
                  className={`flex-none whitespace-nowrap rounded-lg border border-l-[3px] px-2.5 py-2 text-left text-sm transition-colors lg:w-full lg:whitespace-normal ${
                    isSelected
                      ? 'border-transparent bg-primary text-primary-foreground'
                      : 'border-border bg-card text-foreground hover:bg-secondary'
                  }`}
                >
                  <span className="block font-medium leading-tight">{item.name}</span>
                  <span
                    className={`mt-0.5 block font-mono text-[0.7rem] ${
                      isSelected ? 'text-primary-foreground/75' : 'text-muted-foreground'
                    }`}
                  >
                    {item.quantity} available
                  </span>
                </button>
              );
            })}
          </div>
        ))}
      </nav>

      <section className="min-w-0">
        <div className="mb-3">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="font-display text-lg font-semibold leading-none tracking-[-0.01em]">
              {selectedItem.name}
            </h2>
            {selectedItem.requiresApproval ? (
              <Tag tone="requested">Rep approves</Tag>
            ) : (
              <Tag tone="free">Books instantly</Tag>
            )}
          </div>
          {selectedItem.description && (
            <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">
              {selectedItem.description}
            </p>
          )}
        </div>

        <AvailabilityGrid key={selectedItem.id} itemId={selectedItem.id} />
      </section>
    </div>
  );
}
