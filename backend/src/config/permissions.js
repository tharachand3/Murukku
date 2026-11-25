export const ROLES = Object.freeze([
  'SALESMAN',
  'ADMIN',
  'PRODUCTION',
  'ACCOUNTANT',
  'OWNER'
]);

// Capability-to-role matrix: keep authorization policy centralized and auditable.
export const CAPABILITY_MATRIX = Object.freeze({
  'orders:create': Object.freeze(['SALESMAN']),
  'orders:read:own': Object.freeze(['SALESMAN']),
  'orders:read:all': Object.freeze(['ADMIN', 'OWNER', 'ACCOUNTANT']),
  'orders:availability': Object.freeze(['ADMIN', 'OWNER']),
  'masters:read': Object.freeze([...ROLES]),
  'catalog:read': Object.freeze(['SALESMAN', 'ADMIN']),
  'bom:read': Object.freeze(['ADMIN', 'PRODUCTION', 'ACCOUNTANT', 'OWNER']),
  'bom:write': Object.freeze(['ADMIN', 'PRODUCTION']),
  'orders:approve': Object.freeze(['ADMIN']),
  'invoices:write': Object.freeze(['ADMIN']),
  'invoices:read': Object.freeze(['ADMIN', 'ACCOUNTANT', 'OWNER']),
  'dispatch:write': Object.freeze(['ADMIN']),
  'dispatch:read': Object.freeze(['ADMIN', 'ACCOUNTANT', 'OWNER']),
  'payments:write': Object.freeze(['ADMIN']),
  'payments:read': Object.freeze(['ADMIN', 'ACCOUNTANT', 'OWNER']),
  'purchases:write': Object.freeze(['PRODUCTION', 'ADMIN']),
  'production:write': Object.freeze(['PRODUCTION', 'ADMIN']),
  'production:read': Object.freeze(['PRODUCTION', 'ADMIN', 'ACCOUNTANT', 'OWNER']),
  'stock:read': Object.freeze(['ADMIN', 'PRODUCTION', 'ACCOUNTANT', 'OWNER']),
  'stock:adjust': Object.freeze(['ADMIN', 'PRODUCTION']),
  'masters:write': Object.freeze(['ADMIN']),
  'users:manage': Object.freeze(['ADMIN']),
  'reports:read': Object.freeze(['ADMIN', 'ACCOUNTANT', 'OWNER']),
  'audit:read': Object.freeze(['ADMIN', 'ACCOUNTANT', 'OWNER']),
  'dashboard:read': Object.freeze(['OWNER', 'ADMIN']),
  'purchases:read': Object.freeze(['PRODUCTION', 'ADMIN', 'ACCOUNTANT', 'OWNER'])
});
