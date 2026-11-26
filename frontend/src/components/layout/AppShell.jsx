import { useState } from 'react';
import { Link, NavLink, Outlet, useLocation } from 'react-router-dom';
import {
  Activity, Boxes, ClipboardList, CreditCard, FileBarChart, FileText, Home, LayoutDashboard,
  LogOut, Menu, Package, Receipt, Settings, ShoppingCart, Users, X
} from 'lucide-react';
import { useAuth } from '../../context/AuthContext.jsx';
import { useRegistry } from '../../app/RegistryContext.jsx';
import { ROLE_LABELS } from '../../config/roles.js';
import { Avatar } from '../ui/Avatar.jsx';
import { Popover } from '../ui/Popover.jsx';

const ICONS = {
  Home, Dashboard: LayoutDashboard, 'New order': ClipboardList, 'My orders': FileText,
  'My sales': FileBarChart, Orders: ClipboardList, Shortages: Activity, Invoices: Receipt,
  Payments: CreditCard, Receivables: Users, 'Production runs': Activity, 'Recipes (BOM)': Boxes,
  Stock: Package, Purchases: ShoppingCart, Adjustments: Settings, Reports: FileBarChart, Alerts: Activity
};

function BrandMark() {
  return <svg aria-hidden="true" className="h-9 w-9 shrink-0" fill="none" viewBox="0 0 40 40">
    <rect fill="#f0f9f1" height="40" rx="12" width="40" />
    <path d="M20 8c-6 0-10 4-10 9 0 4 3 6 7 6s6-2 6-5c0-2-2-4-4-4s-4 1-4 3c0 2 2 3 4 3s5-1 5-4c0-3-3-6-7-6m3 13c0 5 4 8 8 7" stroke="#2b783d" strokeLinecap="round" strokeWidth="2.7" />
  </svg>;
}

function NavigationLink({ route, onClick, collapsed = false, mobile = false }) {
  const Icon = ICONS[route.nav.label] ?? Package;
  return <NavLink
    aria-label={collapsed ? route.nav.label : undefined}
    className={({ isActive }) => `group relative flex min-h-11 items-center gap-3 rounded-control px-3 text-sm font-medium ${
      isActive ? 'bg-brand-50 text-brand-800 before:absolute before:inset-y-2 before:-left-3 before:w-1 before:rounded-r before:bg-brand-600' : 'text-slate-700 hover:bg-slate-100'
    } ${collapsed ? 'justify-center px-2' : ''} ${mobile ? 'flex-col justify-center gap-0' : ''}`}
    onClick={onClick}
    title={collapsed ? route.nav.label : undefined}
    to={route.path}
  >
    <Icon aria-hidden="true" size={mobile ? 18 : 20} strokeWidth={1.8} />
    {!collapsed && <span className={mobile ? 'text-[11px] leading-4' : ''}>{route.nav.label}</span>}
    {route.nav.badge !== undefined && !collapsed && <span className="ml-auto rounded-full bg-turmeric-100 px-2 text-xs text-slate-900">{route.nav.badge}</span>}
  </NavLink>;
}

function UserMenu({ user, logout, registry, open, setOpen }) {
  const routes = registry.routes();
  return <Popover open={open} onClose={() => setOpen(false)} trigger={
    <button aria-expanded={open} aria-label="User menu" className="flex items-center gap-2 rounded-full p-1 hover:bg-slate-100" onClick={() => setOpen((value) => !value)} type="button">
      <Avatar name={user?.name} />
      <span className="hidden text-left sm:block"><span className="block text-sm font-semibold text-slate-900">{user?.name}</span><span className="mt-0.5 inline-flex rounded-full border border-brand-100 bg-brand-50 px-2 py-0.5 text-[11px] font-semibold text-brand-800">{ROLE_LABELS[user?.role] ?? user?.role}</span></span>
    </button>
  }>
    <div className="border-b border-slate-100 px-3 py-2"><p className="text-sm font-semibold text-slate-900">{user?.name}</p><p className="text-xs text-slate-500">{ROLE_LABELS[user?.role] ?? user?.role}</p></div>
    {routes.some((route) => route.path === '/account') && <Link className="block rounded px-3 py-2 text-sm hover:bg-slate-50" onClick={() => setOpen(false)} to="/account">My account</Link>}
    {routes.some((route) => route.path === '/help') && <Link className="block rounded px-3 py-2 text-sm hover:bg-slate-50" onClick={() => setOpen(false)} to="/help">Help</Link>}
    <button className="flex w-full items-center gap-2 rounded px-3 py-2 text-left text-sm font-semibold text-red-700 hover:bg-red-50" onClick={logout} type="button"><LogOut aria-hidden="true" size={16} />Sign out</button>
  </Popover>;
}

export default function AppShell({ primaryAction }) {
  const { user, notice, logout } = useAuth();
  const registry = useRegistry();
  const location = useLocation();
  const [menuOpen, setMenuOpen] = useState(false);
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(() => localStorage.getItem('oda.sidebar-collapsed') === 'true');
  const nav = registry.navForRole(user?.role) ?? [];
  const salesman = user?.role === 'SALESMAN';
  const mobileTabs = nav.filter((route) => route.nav.mobile && route.path !== '/home').slice(0, 3);
  const groups = nav.reduce((result, route) => {
    if (salesman) return result;
    const group = route.nav.group;
    result[group] ??= [];
    result[group].push(route);
    return result;
  }, {});
  const page = registry.routes().find((route) => route.path === location.pathname
    || route.path.includes(':') && new RegExp(`^${route.path.replace(/:[^/]+/g, '[^/]+')}$`).test(location.pathname));
  const toggleCollapsed = () => setCollapsed((value) => {
    localStorage.setItem('oda.sidebar-collapsed', String(!value));
    return !value;
  });

  return <div className="min-h-screen bg-slate-50 text-slate-900" data-app-shell>
    <a className="sr-only z-[100] rounded bg-white p-3 text-brand-800 focus:not-sr-only focus:fixed focus:left-3 focus:top-3" href="#main-content">Skip to content</a>
    <header className="sticky top-0 z-30 border-b border-slate-200 bg-white/95 backdrop-blur" data-app-topbar>
      <div className={`mx-auto flex min-h-16 items-center justify-between gap-3 px-4 md:px-6 ${salesman ? 'max-w-[480px]' : 'max-w-screen-2xl'}`}>
        <div className="flex items-center gap-3">
          {!salesman && <button aria-expanded={menuOpen} aria-label={menuOpen ? 'Close navigation menu' : 'Open navigation menu'} className="inline-flex h-10 w-10 items-center justify-center rounded-control hover:bg-slate-100 lg:hidden" onClick={() => setMenuOpen((open) => !open)} type="button">{menuOpen ? <X size={20} /> : <Menu size={20} />}</button>}
          <Link className="flex items-center gap-2 text-lg font-bold tracking-tight text-brand-900" to="/home"><BrandMark /><span>Order-to-Audit</span></Link>
        </div>
        {!salesman && <div className="hidden flex-1 pl-8 lg:block"><p className="text-sm font-semibold text-slate-900">{page?.title ?? 'Workspace'}</p><p className="text-xs text-slate-500">Home <span aria-hidden="true">/</span> {page?.title ?? 'Workspace'}</p></div>}
        {!salesman && primaryAction && <div className="hidden lg:block">{primaryAction}</div>}
        <div className="flex items-center gap-2">{notice && <span className="hidden text-xs text-amber-900 sm:inline" role="status">{notice}</span>}<UserMenu user={user} logout={logout} registry={registry} open={userMenuOpen} setOpen={setUserMenuOpen} /></div>
      </div>
      {salesman && <nav aria-label="Sales navigation tabs" className="hidden justify-center gap-2 border-t border-slate-100 px-4 md:flex" data-app-navigation>{mobileTabs.map((route) => <NavigationLink key={route.path} route={route} />)}</nav>}
    </header>
    {!salesman && menuOpen && <div className="fixed inset-0 z-40 bg-slate-950/40 lg:hidden" onMouseDown={(event) => { if (event.target === event.currentTarget) setMenuOpen(false); }}>
      <aside className="h-full w-72 overflow-y-auto bg-white p-4 shadow-modal" aria-label="Mobile sidebar" data-app-sidebar>
        <div className="mb-5 flex items-center justify-between"><span className="font-semibold">Navigation</span><button aria-label="Close navigation menu" className="rounded p-2" onClick={() => setMenuOpen(false)} type="button"><X size={20} /></button></div>
        <nav aria-label="Mobile navigation" data-app-navigation>{Object.entries(groups).map(([group, routes]) => <div className="mb-5" key={group}><p className="px-3 py-2 text-[11px] font-semibold uppercase tracking-wider text-slate-500">{group}</p>{routes.map((route) => <NavigationLink key={route.path} onClick={() => setMenuOpen(false)} route={route} />)}</div>)}</nav>
      </aside>
    </div>}
    <div className={`mx-auto flex max-w-screen-2xl ${salesman ? 'max-w-[480px]' : ''}`}>
      {!salesman && <aside className={`fixed bottom-0 left-0 top-16 z-20 hidden border-r border-slate-200 bg-white px-3 py-5 transition-[width] lg:block ${collapsed ? 'w-[76px]' : 'w-64'}`} data-app-sidebar>
        <div className="mb-5 flex items-center justify-between px-2">{!collapsed && <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">Workspace</span>}<button aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'} className="rounded p-1 text-slate-500 hover:bg-slate-100" onClick={toggleCollapsed} type="button">{collapsed ? <Menu size={18} /> : <X size={18} />}</button></div>
        <nav aria-label="Staff navigation" className="space-y-5" data-app-navigation>{Object.entries(groups).map(([group, routes]) => <div key={group}>{!collapsed && <p className="px-3 pb-1 text-[11px] font-semibold uppercase tracking-wider text-slate-500">{group}</p>}{routes.map((route) => <NavigationLink collapsed={collapsed} key={route.path} route={route} />)}</div>)}</nav>
      </aside>}
      <main className={`page-content min-w-0 flex-1 px-4 py-6 md:px-6 ${salesman ? 'pb-24 text-base leading-6 md:pb-6' : 'mx-auto max-w-[1280px] lg:ml-64'} ${collapsed && !salesman ? 'lg:ml-[76px]' : ''}`} id="main-content" tabIndex={-1}><Outlet /></main>
    </div>
    {salesman && <nav aria-label="Sales navigation" className="fixed inset-x-0 bottom-0 z-30 grid h-14 grid-cols-3 border-t border-slate-200 bg-white px-2 pb-[env(safe-area-inset-bottom)] shadow-[0_-4px_12px_rgba(15,23,42,0.08)] md:hidden" data-app-navigation>{mobileTabs.map((route) => <NavigationLink key={route.path} mobile route={route} />)}</nav>}
  </div>;
}
