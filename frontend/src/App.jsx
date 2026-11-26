import { Navigate, Route, Routes } from 'react-router-dom';
import { useAuth } from './context/AuthContext.jsx';
import { useRegistry } from './app/RegistryContext.jsx';
import { RequireAuth, RequireRole } from './components/guards.jsx';
import AppShell from './components/layout/AppShell.jsx';
import LoginPage from './pages/LoginPage.jsx';
import NotFoundPage from './pages/NotFoundPage.jsx';
import StatusPage from './pages/StatusPage.jsx';
import { Spinner } from './components/ui/Spinner.jsx';
import DesignPage from './pages/dev/DesignPage.jsx';

function HomeRedirect() {
  const { status, user } = useAuth();
  const registry = useRegistry();
  if (status === 'loading') {
    return <Spinner label="Loading your home page" />;
  }
  if (status !== 'authenticated') {
    return <Navigate replace to="/login" />;
  }
  return <Navigate replace to={registry.homePathFor(user.role)} />;
}

// Public routes and registry-driven role-protected application routes.
export default function App() {
  const registry = useRegistry();

  return (
    <Routes>
      <Route element={<LoginPage />} path="/login" />
      <Route element={<StatusPage />} path="/status" />
      {import.meta.env.DEV && <Route element={<DesignPage />} path="/design" />}
      <Route element={<HomeRedirect />} path="/" />
      <Route element={<RequireAuth><AppShell /></RequireAuth>}>
        {registry.routes().map((route) => {
          const Page = route.component;
          return (
            <Route
              element={<RequireRole roles={route.roles}><Page /></RequireRole>}
              key={route.path}
              path={route.path.slice(1)}
            />
          );
        })}
      </Route>
      <Route element={<NotFoundPage />} path="*" />
    </Routes>
  );
}
