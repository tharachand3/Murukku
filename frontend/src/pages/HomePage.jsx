import { Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';
import { useRegistry } from '../app/RegistryContext.jsx';
import { ROLE_LABELS } from '../config/roles.js';
import { Card } from '../components/ui/Card.jsx';
import { EmptyState } from '../components/ui/EmptyState.jsx';
import { PageHeader } from '../components/ui/PageHeader.jsx';

// Role-aware landing page built from registered navigation entries.
export default function HomePage() {
  const { user } = useAuth();
  const registry = useRegistry();
  const pages = registry.navForRole(user?.role) ?? [];
  const groups = pages.reduce((result, route) => {
    const group = route.nav.group;
    result[group] ??= [];
    result[group].push(route);
    return result;
  }, {});

  return (
    <div>
      <PageHeader
        subtitle={ROLE_LABELS[user?.role] ?? 'Order-to-Audit'}
        title={`Welcome, ${user?.name ?? 'there'}`}
      />
      {pages.length === 0 ? (
        <EmptyState title="No pages available" message="Your role has no registered pages yet." />
      ) : (
        <div className="space-y-6">
          {Object.entries(groups).map(([group, routes]) => (
            <section key={group}>
              <h2 className="mb-3 text-lg font-semibold text-slate-800">{group}</h2>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {routes.map((route) => (
                  <Link className="block rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-600" key={route.path} to={route.path}>
                    <Card className="h-full transition hover:border-blue-300 hover:shadow-md">
                      <h3 className="font-semibold text-slate-900">{route.nav.label}</h3>
                      <p className="mt-1 text-sm text-slate-600">Open {route.title}</p>
                    </Card>
                  </Link>
                ))}
              </div>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
