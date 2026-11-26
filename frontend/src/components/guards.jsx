import { Navigate, useLocation, Outlet } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';
import ForbiddenPage from '../pages/ForbiddenPage.jsx';
import { Spinner } from './ui/Spinner.jsx';

export function RequireAuth({ children }) {
  const { status } = useAuth();
  const location = useLocation();

  if (status === 'loading') {
    return <Spinner label="Checking your session" />;
  }
  if (status !== 'authenticated') {
    return <Navigate to="/login" replace state={{ from: location }} />;
  }
  return children ?? <Outlet />;
}

export function RequireRole({ roles, children }) {
  const { status, user } = useAuth();
  if (status === 'loading') {
    return <Spinner label="Checking your session" />;
  }
  if (status !== 'authenticated') {
    return <Navigate to="/login" replace />;
  }
  if (!roles.includes(user?.role)) {
    return <ForbiddenPage />;
  }
  return children ?? <Outlet />;
}
