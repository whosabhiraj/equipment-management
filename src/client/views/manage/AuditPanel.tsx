import { useQuery } from '@tanstack/react-query';
import { Card, Empty, Loading } from '../../components/ui';
import type { AuditItem } from './types';

/** Machine action names are for the log table, not for the person reading it. */
const ACTION_LABELS: Record<string, string> = {
  approve_booking: 'approved a booking',
  cancel_booking: 'cancelled a booking',
  mark_no_show: 'marked a no-show',
  create_blackout: 'closed a slot',
  create_item: 'added equipment',
  update_item: 'edited equipment',
  delete_category: 'removed a group',
  add_user: 'added a person',
  update_user: 'changed a person',
  disable_user: 'blocked a person',
  bulk_import_users: 'added people in bulk',
  email_failure: 'an email failed to send',
};

export default function AuditPanel() {
  const { data: logs, isLoading } = useQuery<AuditItem[]>({
    queryKey: ['audit'],
    queryFn: async () => {
      const res = await fetch('/api/users/audit');
      if (!res.ok) throw new Error('Audit fetch error');
      return res.json();
    },
  });

  if (isLoading) return <Loading label="Loading history" />;

  if (!logs || logs.length === 0) {
    return <Empty title="Nothing recorded yet">Approvals, closures and people changes are logged here.</Empty>;
  }

  return (
    <Card className="divide-y divide-border overflow-hidden">
      {logs.map((l) => (
        <div key={l.id} className="px-3.5 py-2.5">
          <p className="text-sm leading-snug">
            <span className="font-medium">{l.actorName}</span>{' '}
            <span className="text-muted-foreground">{ACTION_LABELS[l.action] ?? l.action}</span>
          </p>
          <p className="mt-0.5 font-mono text-xs text-muted-foreground">
            {new Date(l.createdAt).toLocaleString('en-IN', {
              day: 'numeric',
              month: 'short',
              hour: '2-digit',
              minute: '2-digit',
            })}
            {' · '}
            {l.targetType}
          </p>
        </div>
      ))}
    </Card>
  );
}
