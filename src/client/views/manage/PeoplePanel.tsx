import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import PeopleImporter from '../../components/PeopleImporter';
import { Button, Card, Loading, Notice, SectionTitle, Tag, inputClass } from '../../components/ui';
import type { ManagedUser } from './types';

export default function PeoplePanel() {
  const queryClient = useQueryClient();
  const [search, setSearch] = useState('');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  const { data: users, isLoading } = useQuery<ManagedUser[]>({
    queryKey: ['users'],
    queryFn: async () => {
      const res = await fetch('/api/users');
      if (!res.ok) throw new Error('People fetch error');
      return res.json();
    },
  });

  const update = useMutation({
    mutationFn: async (payload: ManagedUser) => {
      const res = await fetch(`/api/users/${payload.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          role: payload.role,
          roomNo: payload.roomNo,
          disabled: payload.disabled,
        }),
      });
      if (!res.ok) {
        const err = (await res.json()) as { error?: string };
        throw new Error(err.error || 'Could not update that person.');
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['users'] });
      queryClient.invalidateQueries({ queryKey: ['audit'] });
      setError('');
    },
    onError: (err: Error) => setError(err.message),
  });

  const query = search.trim().toLowerCase();
  const visible = users?.filter(
    (u) =>
      !query ||
      u.name.toLowerCase().includes(query) ||
      u.email.toLowerCase().includes(query) ||
      (u.roomNo ?? '').toLowerCase().includes(query)
  );

  return (
    <div className="space-y-5">
      <PeopleImporter
        onSuccess={(count) => setMessage(`Added ${count} ${count === 1 ? 'person' : 'people'} to the hostel.`)}
      />

      {message && <Notice tone="free">{message}</Notice>}
      {error && <Notice tone="taken">{error}</Notice>}

      <section>
        <SectionTitle>Everyone in the hostel</SectionTitle>

        <label className="mb-2.5 block">
          <span className="sr-only">Search people</span>
          <input
            type="search"
            placeholder="Search by name, email or room"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className={inputClass}
          />
        </label>

        {isLoading ? (
          <Loading label="Loading people" />
        ) : (
          <Card className="divide-y divide-border overflow-hidden">
            {visible?.length === 0 && (
              <p className="px-3.5 py-5 text-sm text-muted-foreground">
                Nobody matches “{search}”.
              </p>
            )}
            {visible?.map((u) => (
              <div key={u.id} className="px-3.5 py-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="truncate text-sm font-medium">{u.name}</span>
                      {u.role === 'admin' && <Tag tone="accent">Admin</Tag>}
                      {u.role === 'rep' && <Tag tone="free">Rep</Tag>}
                      {u.disabled && <Tag tone="taken">Blocked</Tag>}
                    </div>
                    <p className="mt-0.5 truncate font-mono text-xs text-muted-foreground">
                      {u.email}
                      {u.roomNo && ` · Room ${u.roomNo}`}
                    </p>
                  </div>
                </div>

                <div className="mt-2 flex gap-2">
                  <label className="flex-1">
                    <span className="sr-only">Role for {u.name}</span>
                    <select
                      value={u.role}
                      onChange={(e) =>
                        update.mutate({ ...u, role: e.target.value as ManagedUser['role'] })
                      }
                      className={`${inputClass} py-1.5 text-xs`}
                    >
                      <option value="resident">Resident</option>
                      <option value="rep">Sports rep</option>
                      <option value="admin">Admin</option>
                    </select>
                  </label>

                  <Button
                    variant={u.disabled ? 'outline' : 'danger'}
                    size="sm"
                    onClick={() => update.mutate({ ...u, disabled: !u.disabled })}
                  >
                    {u.disabled ? 'Let back in' : 'Block'}
                  </Button>
                </div>
              </div>
            ))}
          </Card>
        )}
      </section>
    </div>
  );
}
