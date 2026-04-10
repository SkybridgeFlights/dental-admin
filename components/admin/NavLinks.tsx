'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

const NAV_ITEMS = [
  { href: '/dashboard',                   label: 'Overview'         },
  { href: '/dashboard/clinics',           label: 'Clinics'          },
  { href: '/dashboard/onboard',           label: 'Onboard Clinic'   },
  { href: '/dashboard/licenses/generate', label: 'Generate License' },
  { href: '/dashboard/audit',             label: 'Audit Log'        },
] as const;

export function NavLinks() {
  const pathname = usePathname();

  return (
    <nav className="flex flex-1 flex-col gap-0.5 px-2 py-3">
      {NAV_ITEMS.map(({ href, label }) => {
        // Exact match for /dashboard; prefix match for everything else
        const isActive =
          href === '/dashboard'
            ? pathname === '/dashboard'
            : pathname === href || pathname.startsWith(`${href}/`);

        return (
          <Link
            key={href}
            href={href}
            className={[
              'rounded-md px-3 py-2 text-sm transition-colors',
              isActive
                ? 'bg-slate-700/70 font-medium text-slate-100'
                : 'text-slate-300 hover:bg-slate-800 hover:text-slate-100',
            ].join(' ')}
          >
            {label}
          </Link>
        );
      })}
    </nav>
  );
}
