import { useAuth } from '../context/AuthContext.jsx';

// Sign-in form arrives with the next frontend step.
export default function LoginPage() {
  const { notice } = useAuth();
  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-100 p-6">
      <section className="w-full max-w-md rounded-xl bg-white p-8 text-center shadow">
        <h1 className="text-2xl font-bold text-slate-900">Sign in</h1>
        {notice && <p className="mt-3 text-sm text-amber-800" role="status">{notice}</p>}
        <p className="mt-3 text-slate-600">Sign-in screen arrives in step 47</p>
      </section>
    </main>
  );
}
