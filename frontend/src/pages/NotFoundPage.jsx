import { Link } from 'react-router-dom';

// Standalone not-found page for unknown client routes.
export default function NotFoundPage() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-100 p-6">
      <section className="max-w-md rounded-xl bg-white p-8 text-center shadow">
        <h1 className="text-2xl font-bold text-slate-900">Page not found</h1>
        <p className="mt-2 text-slate-600">The page you requested does not exist.</p>
        <Link className="mt-5 inline-block font-medium text-blue-700 underline" to="/">Go home</Link>
      </section>
    </main>
  );
}
