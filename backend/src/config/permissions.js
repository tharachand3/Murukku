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
  'orders:approve': Object.freeze(['ADMIN']),
  'invoices:write': Object.freeze(['ADMIN']),
  'invoices:read': Object.freeze(['ADMIN', 'ACCOUNTANT', 'OWNER']),
  'dispatch:write': Object.freeze(['ADMIN']),
  'payments:write': Object.freeze(['ADMIN']),
  'purchases:write': Object.freeze(['PRODUCTION', 'ADMIN']),
  'production:write': Object.freeze(['PRODUCTION', 'ADMIN']),
  'production:read': Object.freeze(['PRODUCTION', 'ADMIN', 'ACCOUNTANT', 'OWNER']),
  'stock:read': Object.freeze(['ADMIN', 'PRODUCTION', 'ACCOUNTANT', 'OWNER']),
  'masters:write': Object.freeze(['ADMIN']),
  'reports:read': Object.freeze(['ADMIN', 'ACCOUNTANT', 'OWNER']),
  'audit:read': Object.freeze(['ADMIN', 'ACCOUNTANT', 'OWNER']),
  'dashboard:read': Object.freeze(['OWNER', 'ADMIN']),
  'purchases:read': Object.freeze(['PRODUCTION', 'ADMIN', 'ACCOUNTANT', 'OWNER'])
});
