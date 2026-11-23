import { useEffect, useState } from 'react';
import { api } from './lib/api.js';

function App() {
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    api.get('/health')
      .then(() => setConnected(true))
      .catch(() => setConnected(false));
  }, []);

  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-100 px-4">
      <section className="w-full max-w-md rounded-xl bg-white p-8 text-center shadow-lg">
        <h1 className="text-2xl font-bold text-slate-900">Order-to-Audit System</h1>
        <p className={`mt-4 font-medium ${connected ? 'text-green-600' : 'text-red-600'}`}>
          API: {connected ? 'connected' : 'down'}
        </p>
      </section>
    </main>
  );
}

export default App;
