import { requireAdmin }  from '@/lib/auth/require-admin';
import { NavLinks }      from '@/components/admin/NavLinks';
import { LogoutButton }  from './LogoutButton';

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const user = await requireAdmin();

  return (
    <div className="flex min-h-screen">
      {/* Sidebar */}
      <aside className="flex w-56 shrink-0 flex-col border-r border-slate-700/60 bg-slate-900">
        <div className="border-b border-slate-700/60 px-4 py-4">
          <p className="font-semibold text-slate-100">DentalPro</p>
          <p className="text-xs text-slate-500">Admin</p>
        </div>

        {/* NavLinks is a client component — handles active highlighting via usePathname */}
        <NavLinks />

        <div className="border-t border-slate-700/60 px-4 py-3">
          <p className="mb-2 truncate text-xs text-slate-500">{user.email}</p>
          <LogoutButton />
        </div>
      </aside>

      {/* Main content */}
      <main className="flex-1 overflow-y-auto p-8">
        {children}
      </main>
    </div>
  );
}
