export const DEMO_LOGINS = Object.freeze([
  { role: 'ADMIN', label: 'Factory admin', email: 'admin@demo.com' },
  { role: 'PRODUCTION', label: 'Production supervisor', email: 'production@demo.com' },
  { role: 'SALESMAN', label: 'Salesman A', email: 'salesman.a@demo.com' },
  { role: 'SALESMAN', label: 'Salesman B', email: 'salesman.b@demo.com' },
  { role: 'ACCOUNTANT', label: 'Accountant / auditor', email: 'accountant@demo.com' },
  { role: 'OWNER', label: 'Owner', email: 'owner@demo.com' }
]);

export const DEMO_PASSWORD = 'Demo@123';

export function showDemoLogins() {
  // Vite exposes import.meta.env at build time; in tests we stub it.
  return import.meta.env.VITE_SHOW_DEMO_LOGINS !== 'false';
}