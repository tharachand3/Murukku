import { useState } from 'react';
import { Link, NavLink, Outlet } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext.jsx';
import { useRegistry } from '../../app/RegistryContext.jsx';
import { ROLE_LABELS } from '../../config/roles.js';
import { Button } from '../ui/Button.jsx';

function NavigationLink({ route, onClick }) {
  return (
    <NavLink
      className={({ isActive }) => `flex min-h-11 items-center rounded-lg px-3 text-sm font-medium ${
        isActive ? 'bg-blue-100 text-blue-900' : 'text-slate-700 hover:bg-slate-100'
      }`}
      onClick={onClick}
      to={route.path}
    >
      {route.nav.label}
    </NavLink>
  );
}

// Role-based shell with salesperson tabs and staff sidebar navigation.
export default function AppShell() {
  const { user, notice, logout } = useAuth();
  const registry = useRegistry();
  const [menuOpen, setMenuOpen] = useState(false);
  const nav = registry.navForRole(user?.role) ?? [];
  const salesman = user?.role === 'SALESMAN';
  const mobileTabs = nav.filter((route) => route.nav.mobile).slice(0, 5);
  const groups = nav.reduce((result, route) => {
    if (route.nav.mobile && salesman) {
      return result;
    }
    const group = route.nav.group;
    result[group] ??= [];
    result[group].push(route);
    return result;
  }, {});

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900">
      <header className="sticky top-0 z-30 border-b border-slate-200 bg-white">
        <div className="flex min-h-16 items-center justify-between gap-3 px-4 md:px-6">
          <div className="flex items-center gap-3">
            {!salesman && (
              <button
                aria-expanded={menuOpen}
                aria-label={menuOpen ? 'Close navigation menu' : 'Open navigation menu'}
                className="inline-flex h-11 w-11 items-center justify-center rounded-lg border border-slate-300 md:hidden"
                onClick={() => setMenuOpen((open) => !open)}
                type="button"
              >
                <span aria-hidden="true">☰</span>
              </button>
            )}
            <Link className="font-bold text-slate-900" to="/home">Order-to-Audit</Link>
          </div>
          <div className="flex items-center gap-3">
            <span className="hidden text-sm text-slate-700 sm:inline">{user?.name}</span>
            <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-700">
              {ROLE_LABELS[user?.role] ?? user?.role}
            </span>
            <Button onClick={logout} variant="ghost">Logout</Button>
          </div>
        </div>
      </header>

      {notice && (
        <div className="mx-4 mt-4 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 md:mx-6" role="status">
          {notice}
        </div>
      )}

      {!salesman && menuOpen && (
        <nav aria-label="Mobile navigation" className="border-b border-slate-200 bg-white p-4 md:hidden">
          {Object.entries(groups).map(([group, routes]) => (
            <div className="mb-4" key={group}>
              <p className="px-3 py-1 text-xs font-semibold uppercase tracking-wide text-slate-500">{group}</p>
              {routes.map((route) => (
                <NavigationLink key={route.path} onClick={() => setMenuOpen(false)} route={route} />
              ))}
            </div>
          ))}
        </nav>
      )}

      <div className="mx-auto flex max-w-screen-2xl">
        {!salesman && (
          <aside className="hidden min-h-[calc(100vh-4rem)] w-60 shrink-0 border-r border-slate-200 bg-white px-3 py-5 md:block">
            <nav aria-label="Staff navigation" className="space-y-5">
              {Object.entries(groups).map(([group, routes]) => (
                <div key={group}>
                  <p className="px-3 pb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">{group}</p>
                  {routes.map((route) => <NavigationLink key={route.path} route={route} />)}
                </div>
              ))}
            </nav>
          </aside>
        )}
        <main className={`min-w-0 flex-1 p-4 md:p-6 ${salesman ? 'pb-24' : ''}`}>
          <Outlet />
        </main>
      </div>

      {salesman && mobileTabs.length > 0 && (
        <nav
          aria-label="Sales navigation"
          className="fixed inset-x-0 bottom-0 z-30 flex justify-around border-t border-slate-200 bg-white px-2 pt-2 pb-[env(safe-area-inset-bottom)] shadow-[0_-4px_12px_rgba(15,23,42,0.08)]"
        >
          {mobileTabs.map((route) => (
            <NavigationLink key={route.path} route={route} />
          ))}
        </nav>
      )}
    </div>
  );
}
