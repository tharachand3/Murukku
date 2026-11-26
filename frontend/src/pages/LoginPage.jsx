import { useRef, useState } from 'react';
import { Navigate, useLocation, useNavigate } from 'react-router-dom';
import { useRegistry } from '../app/RegistryContext.jsx';
import { useAuth } from '../context/AuthContext.jsx';
import { Button } from '../components/ui/Button.jsx';
import { Input } from '../components/ui/Input.jsx';
import { Spinner } from '../components/ui/Spinner.jsx';
import { fieldErrors, toApiError } from '../lib/apiError.js';
import { DEMO_LOGINS, DEMO_PASSWORD, showDemoLogins } from '../config/demoLogins.js';

function redirectFor(user, from, registry) {
  const allowedRoute = from?.pathname
    ? registry.routesForRole(user.role).find((route) => route.path === from.pathname)
    : null;
  if (allowedRoute) {
    return {
      pathname: allowedRoute.path,
      search: from.search ?? '',
      hash: from.hash ?? ''
    };
  }
  return registry.homePathFor(user.role);
}

export default function LoginPage() {
  const { login, notice, status, user } = useAuth();
  const registry = useRegistry();
  const location = useLocation();
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [pending, setPending] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');
  const [errors, setErrors] = useState({});
  const [noticeDismissed, setNoticeDismissed] = useState(false);
  const submitting = useRef(false);

  if (status === 'loading') {
    return (
      <main className="flex min-h-screen items-center justify-center bg-slate-100 p-4">
        <Spinner label="Checking your session" />
      </main>
    );
  }
  if (status === 'authenticated' && user) {
    return <Navigate replace to={redirectFor(user, location.state?.from, registry)} />;
  }

  const clearNotice = () => {
    if (notice) setNoticeDismissed(true);
  };

  const handleSubmit = async (event) => {
    event.preventDefault();
    if (submitting.current) return;

    const trimmedEmail = email.trim();
    const nextErrors = {};
    if (!trimmedEmail) nextErrors.email = 'Email is required';
    else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmedEmail)) {
      nextErrors.email = 'Enter a valid email address';
    }
    if (!password) nextErrors.password = 'Password is required';
    setErrors(nextErrors);
    setErrorMessage('');
    if (Object.keys(nextErrors).length) return;

    submitting.current = true;
    setPending(true);
    try {
      const loggedInUser = await login(trimmedEmail, password);
      navigate(redirectFor(loggedInUser, location.state?.from, registry), { replace: true });
    } catch (error) {
      const apiError = toApiError(error);
      const serverFields = apiError.status === 400 ? fieldErrors(apiError.details) : {};
      setErrors(serverFields);
      setErrorMessage(apiError.message);
    } finally {
      submitting.current = false;
      setPending(false);
    }
  };

  const fillDemo = (demo) => {
    setEmail(demo.email);
    setPassword(DEMO_PASSWORD);
    setErrors({});
    setErrorMessage('');
    clearNotice();
  };

  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-100 p-4">
      <section className="w-full max-w-md rounded-xl bg-white p-6 shadow-lg sm:p-8">
        <header className="text-center">
          <h1 className="text-2xl font-bold text-slate-900">Order-to-Audit</h1>
          <p className="mt-2 text-slate-600">Sign in to continue</p>
        </header>

        {notice && !noticeDismissed && (
          <p className="mt-5 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900" role="status">
            {notice}
          </p>
        )}
        {errorMessage && (
          <p className="mt-5 rounded-lg border border-red-300 bg-red-50 p-3 text-sm text-red-900" role="alert">
            {errorMessage}
          </p>
        )}

        <form className="mt-6 space-y-4" noValidate onSubmit={handleSubmit}>
          <Input
            autoComplete="username"
            autoFocus
            error={errors.email}
            label="Email"
            onChange={(event) => {
              setEmail(event.target.value);
              setErrors((current) => ({ ...current, email: undefined }));
              clearNotice();
            }}
            type="email"
            value={email}
          />
          <div>
            <Input
              autoComplete="current-password"
              error={errors.password}
              label="Password"
              onChange={(event) => {
                setPassword(event.target.value);
                setErrors((current) => ({ ...current, password: undefined }));
                clearNotice();
              }}
              type={showPassword ? 'text' : 'password'}
              value={password}
            />
            <button
              className="mt-2 min-h-11 rounded px-2 text-sm font-medium text-blue-800 hover:bg-blue-50"
              disabled={pending}
              onClick={() => setShowPassword((current) => !current)}
              type="button"
            >
              {showPassword ? 'Hide' : 'Show'}
            </button>
          </div>
          <Button className="w-full" disabled={pending} loading={pending} type="submit">
            {pending ? 'Signing in…' : 'Sign in'}
          </Button>
        </form>

        {showDemoLogins() && (
          <details className="mt-6 border-t border-slate-200 pt-4">
            <summary className="min-h-11 cursor-pointer py-2 font-semibold text-slate-800">
              Demo logins
            </summary>
            <ul className="mt-2 space-y-2">
              {DEMO_LOGINS.map((demo) => (
                <li key={demo.email}>
                  <button
                    className="min-h-11 w-full rounded-lg border border-slate-200 px-3 py-2 text-left text-sm hover:bg-slate-50"
                    disabled={pending}
                    onClick={() => fillDemo(demo)}
                    type="button"
                  >
                    <span className="font-medium text-slate-900">{demo.label}</span>
                    <span className="ml-2 text-slate-500">{demo.role}</span>
                  </button>
                </li>
              ))}
            </ul>
          </details>
        )}
      </section>
    </main>
  );
}
