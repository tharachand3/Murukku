import { Link } from 'react-router-dom';

// Standalone response for authenticated users outside a route's allowed roles.
export default function ForbiddenPage() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-100 p-6">
      <section className="max-w-md rounded-xl bg-white p-8 text-center shadow">
        <h1 className="text-2xl font-bold text-slate-900">Access denied</h1>
        <p className="mt-2 text-slate-600">Your account does not have access to this page.</p>
        <Link className="mt-5 inline-block font-medium text-blue-700 underline" to="/home">Go to Home</Link>
      </section>
    </main>
  );
}
