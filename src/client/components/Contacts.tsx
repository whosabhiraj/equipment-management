import { Mail, Phone } from 'lucide-react';

/**
 * Who to actually reach when the portal cannot help — being added to the
 * hostel, a blocked account, an item that is missing from the store room.
 */
const CONTACTS = [
  {
    name: 'Kavya Gupta',
    phone: '+91 98992 83263',
    tel: '+919899283263',
    email: 'f20240715@pilani.bits-pilani.ac.in',
  },
];

export default function Contacts({ className = '' }: { className?: string }) {
  return (
    <section aria-labelledby="contacts-heading" className={className}>
      <h2 id="contacts-heading" className="label-micro mb-2">
        Contact
      </h2>

      <p className="mb-3 max-w-sm text-sm leading-relaxed text-muted-foreground">
        For access to the portal, or anything the store room cannot sort out.
      </p>

      <ul className="space-y-2.5">
        {CONTACTS.map((person) => (
          <li key={person.email} className="rounded-lg border border-border bg-card p-3">
            <p className="text-sm font-semibold tracking-tight">{person.name}</p>

            <div className="mt-1.5 flex flex-col gap-1.5 sm:flex-row sm:flex-wrap sm:gap-x-4">
              <a
                href={`tel:${person.tel}`}
                className="inline-flex items-center gap-1.5 font-mono text-xs text-muted-foreground transition-colors hover:text-primary"
              >
                <Phone className="h-3.5 w-3.5 flex-none" />
                {person.phone}
              </a>
              <a
                href={`mailto:${person.email}`}
                className="inline-flex min-w-0 items-center gap-1.5 font-mono text-xs text-muted-foreground transition-colors hover:text-primary"
              >
                <Mail className="h-3.5 w-3.5 flex-none" />
                <span className="truncate">{person.email}</span>
              </a>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
