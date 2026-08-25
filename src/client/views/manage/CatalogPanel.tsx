import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus } from 'lucide-react';
import { getSlotTimeRange } from '../../../shared/slots';
import { Button, Card, Empty, Field, Notice, SectionTitle, Tag, inputClass } from '../../components/ui';
import type { DbCategory, DbItem } from './types';

const BLANK = {
  categoryId: '',
  name: '',
  description: '',
  quantity: 1,
  active: true,
  requiresApproval: true,
  maxSlotsPerBooking: 2,
  earliestSlot: 0,
  latestSlot: 17,
  advanceDays: 7,
};

export default function CatalogPanel() {
  const queryClient = useQueryClient();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [isOpen, setIsOpen] = useState(false);
  const [form, setForm] = useState({ ...BLANK });
  const [error, setError] = useState('');
  const [newCategory, setNewCategory] = useState('');
  const [showCategory, setShowCategory] = useState(false);

  const { data: categories } = useQuery<DbCategory[]>({
    queryKey: ['flat-categories'],
    queryFn: async () => {
      const res = await fetch('/api/items');
      const cats = (await res.json()) as DbCategory[];
      return cats.map((c) => ({ id: c.id, name: c.name, sortOrder: c.sortOrder }));
    },
  });

  const { data: items } = useQuery<DbItem[]>({
    queryKey: ['flat-items'],
    queryFn: async () => {
      const res = await fetch('/api/items');
      const cats = (await res.json()) as { id: string; items: DbItem[] }[];
      return cats.flatMap((c) => c.items.map((i) => ({ ...i, categoryId: c.id })));
    },
  });

  const saveCategory = useMutation({
    mutationFn: async (name: string) => {
      const res = await fetch('/api/items/categories', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, sortOrder: 0 }),
      });
      if (!res.ok) throw new Error('Could not add that group.');
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['flat-categories'] });
      queryClient.invalidateQueries({ queryKey: ['catalog'] });
      setNewCategory('');
      setShowCategory(false);
    },
  });

  const saveItem = useMutation({
    mutationFn: async () => {
      const url = editingId ? `/api/items/${editingId}` : '/api/items';
      const res = await fetch(url, {
        method: editingId ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...form, description: form.description || null }),
      });
      if (!res.ok) {
        const err = (await res.json()) as { error?: string };
        throw new Error(err.error || 'Could not save that item.');
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['flat-items'] });
      queryClient.invalidateQueries({ queryKey: ['catalog'] });
      setIsOpen(false);
      setEditingId(null);
      setError('');
    },
    onError: (err: Error) => setError(err.message),
  });

  const startEdit = (item: DbItem) => {
    setEditingId(item.id);
    setIsOpen(true);
    setError('');
    setForm({
      categoryId: item.categoryId,
      name: item.name,
      description: item.description ?? '',
      quantity: item.quantity,
      active: item.active,
      requiresApproval: item.requiresApproval,
      maxSlotsPerBooking: item.maxSlotsPerBooking,
      earliestSlot: item.earliestSlot,
      latestSlot: item.latestSlot,
      advanceDays: item.advanceDays,
    });
  };

  const startCreate = () => {
    setEditingId(null);
    setIsOpen(true);
    setError('');
    setForm({ ...BLANK, categoryId: categories?.[0]?.id ?? '' });
  };

  return (
    <div className="space-y-5">
      <SectionTitle
        action={
          <div className="flex gap-1.5">
            <Button variant="outline" size="sm" onClick={() => setShowCategory(!showCategory)}>
              <Plus className="h-3.5 w-3.5" /> Group
            </Button>
            <Button size="sm" onClick={startCreate}>
              <Plus className="h-3.5 w-3.5" /> Item
            </Button>
          </div>
        }
      >
        Equipment
      </SectionTitle>

      {showCategory && (
        <Card className="flex gap-2 p-3">
          <input
            type="text"
            placeholder="Group name — e.g. Indoor games"
            value={newCategory}
            onChange={(e) => setNewCategory(e.target.value)}
            className={inputClass}
            aria-label="Group name"
          />
          <Button disabled={!newCategory.trim()} onClick={() => saveCategory.mutate(newCategory)}>
            Add
          </Button>
        </Card>
      )}

      {isOpen && (
        <Card className="space-y-3 p-3.5">
          <h3 className="font-display text-base font-semibold">
            {editingId ? 'Edit item' : 'New item'}
          </h3>

          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Group">
              <select
                value={form.categoryId}
                onChange={(e) => setForm({ ...form, categoryId: e.target.value })}
                className={inputClass}
              >
                {categories?.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </Field>

            <Field label="Name">
              <input
                type="text"
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                className={inputClass}
              />
            </Field>

            <div className="sm:col-span-2">
              <Field label="Description">
                <input
                  type="text"
                  value={form.description}
                  onChange={(e) => setForm({ ...form, description: e.target.value })}
                  className={inputClass}
                />
              </Field>
            </div>

            <Field label="How many" hint="Copies in the store room.">
              <input
                type="number"
                min={0}
                value={form.quantity}
                onChange={(e) => setForm({ ...form, quantity: Number(e.target.value) })}
                className={inputClass}
              />
            </Field>

            <Field label="Hours in a row" hint="Most a resident can take at once.">
              <input
                type="number"
                min={1}
                max={18}
                value={form.maxSlotsPerBooking}
                onChange={(e) => setForm({ ...form, maxSlotsPerBooking: Number(e.target.value) })}
                className={inputClass}
              />
            </Field>

            <Field label="Opens">
              <select
                value={form.earliestSlot}
                onChange={(e) => setForm({ ...form, earliestSlot: Number(e.target.value) })}
                className={inputClass}
              >
                {Array.from({ length: 18 }, (_, i) => (
                  <option key={i} value={i}>
                    {getSlotTimeRange(i, true).split(' - ')[0]}
                  </option>
                ))}
              </select>
            </Field>

            <Field label="Closes">
              <select
                value={form.latestSlot}
                onChange={(e) => setForm({ ...form, latestSlot: Number(e.target.value) })}
                className={inputClass}
              >
                {Array.from({ length: 18 }, (_, i) => (
                  <option key={i} value={i}>
                    {getSlotTimeRange(i, true).split(' - ')[1]}
                  </option>
                ))}
              </select>
            </Field>

            <Field label="Book ahead" hint="Days into the future.">
              <input
                type="number"
                min={1}
                max={30}
                value={form.advanceDays}
                onChange={(e) => setForm({ ...form, advanceDays: Number(e.target.value) })}
                className={inputClass}
              />
            </Field>
          </div>

          <div className="space-y-2 border-t border-border pt-3">
            <label className="flex cursor-pointer items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={form.active}
                onChange={(e) => setForm({ ...form, active: e.target.checked })}
                className="h-4 w-4 accent-[var(--color-primary)]"
              />
              Residents can see it
            </label>
            <label className="flex cursor-pointer items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={form.requiresApproval}
                onChange={(e) => setForm({ ...form, requiresApproval: e.target.checked })}
                className="h-4 w-4 accent-[var(--color-primary)]"
              />
              You approve each request
              <span className="text-xs text-muted-foreground">(off = books instantly)</span>
            </label>
          </div>

          {error && <Notice tone="taken">{error}</Notice>}

          <div className="flex gap-2">
            <Button className="flex-1" disabled={saveItem.isPending} onClick={() => saveItem.mutate()}>
              {saveItem.isPending ? 'Saving…' : 'Save item'}
            </Button>
            <Button variant="outline" onClick={() => setIsOpen(false)}>
              Cancel
            </Button>
          </div>
        </Card>
      )}

      {!items || items.length === 0 ? (
        <Empty title="No equipment yet">Add the first racquet, board or ball with the Item button.</Empty>
      ) : (
        <Card className="divide-y divide-border overflow-hidden">
          {items.map((item) => (
            <div key={item.id} className="flex items-center gap-3 px-3.5 py-3">
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="truncate text-sm font-medium">{item.name}</span>
                  {!item.active && <Tag>Hidden</Tag>}
                  {item.requiresApproval ? <Tag tone="requested">Approve</Tag> : <Tag tone="free">Instant</Tag>}
                </div>
                <p className="mt-0.5 font-mono text-xs text-muted-foreground">
                  {item.quantity} copies · {item.maxSlotsPerBooking}h max ·{' '}
                  {getSlotTimeRange(item.earliestSlot, true).split(' - ')[0]}–
                  {getSlotTimeRange(item.latestSlot, true).split(' - ')[1]}
                </p>
              </div>
              <Button variant="outline" size="sm" onClick={() => startEdit(item)}>
                Edit
              </Button>
            </div>
          ))}
        </Card>
      )}
    </div>
  );
}
