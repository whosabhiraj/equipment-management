import QueuePanel from './manage/QueuePanel';
import TodayPanel from './manage/TodayPanel';
import BlackoutsPanel from './manage/BlackoutsPanel';
import CatalogPanel from './manage/CatalogPanel';
import PeoplePanel from './manage/PeoplePanel';
import AuditPanel from './manage/AuditPanel';

export type ManageTab = 'queue' | 'today' | 'items' | 'blackouts' | 'people' | 'history';

const REP_TABS: { id: ManageTab; label: string }[] = [
  { id: 'queue', label: 'Requests' },
  { id: 'today', label: 'Today' },
  { id: 'items', label: 'Equipment' },
  { id: 'blackouts', label: 'Closures' },
];

const ADMIN_TABS: { id: ManageTab; label: string }[] = [
  { id: 'people', label: 'People' },
  { id: 'history', label: 'History' },
];

type ManageViewProps = {
  tab: ManageTab;
  setTab: (tab: ManageTab) => void;
  isAdmin: boolean;
};

export default function ManageView({ tab, setTab, isAdmin }: ManageViewProps) {
  const tabs = isAdmin ? [...REP_TABS, ...ADMIN_TABS] : REP_TABS;
  const active = tabs.some((t) => t.id === tab) ? tab : 'queue';

  return (
    <div>
      {/* A scrolling chip rail, not a sidebar — six stacked buttons would cost a
          phone screen before the rep sees a single request. */}
      <div
        role="tablist"
        aria-label="Manage sections"
        className="-mx-4 mb-4 flex gap-1.5 overflow-x-auto px-4 pb-1 scrollbar-none"
      >
        {tabs.map((t) => (
          <button
            key={t.id}
            role="tab"
            aria-selected={active === t.id}
            onClick={() => setTab(t.id)}
            className={`flex-none whitespace-nowrap rounded-lg border px-2.5 py-1.5 text-sm font-medium tracking-tight transition-colors ${
              active === t.id
                ? 'border-transparent bg-primary text-primary-foreground'
                : 'border-border bg-card text-muted-foreground hover:bg-secondary'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {active === 'queue' && <QueuePanel />}
      {active === 'today' && <TodayPanel />}
      {active === 'items' && <CatalogPanel />}
      {active === 'blackouts' && <BlackoutsPanel />}
      {active === 'people' && isAdmin && <PeoplePanel />}
      {active === 'history' && isAdmin && <AuditPanel />}
    </div>
  );
}
