const LOOKUP_ROLES = ['ADMIN', 'PRODUCTION', 'ACCOUNTANT', 'OWNER'];
const LOOKUP_FILTERS = {
  customerId: { endpoint: '/customers', label: 'Customer' },
  supplierId: { endpoint: '/suppliers', label: 'Supplier' },
  itemId: { endpoint: '/items', label: 'Item' },
  finishedItemId: { endpoint: '/items', label: 'Finished item', itemType: 'FINISHED' }
};

const ENUMS = {
  status: {
    'sales-register': ['ALL', 'POSTED', 'CANCELLED'],
    'production-report': ['ALL', 'COMPLETED', 'ISSUED', 'CANCELLED']
  },
  taxType: ['ALL', 'INTRA', 'INTER'],
  customerType: ['RETAILER', 'DISTRIBUTOR'],
  type: {
    'purchase-register': ['RAW', 'PACKAGING'],
    'stock-summary': ['RAW', 'PACKAGING', 'FINISHED'],
    'stock-ledger': ['RAW', 'PACKAGING', 'FINISHED']
  }
};

const CHECKBOX_FILTERS = new Set(['hideEmpty', 'flaggedOnly', 'detail']);
const REPORT_DEFAULTS = {
  'sales-register': { status: 'ALL', taxType: 'ALL' },
  'production-report': { status: 'COMPLETED' }
};

export function reportFilterUi(reportKey, filter) {
  const { name, type } = filter;
  if (name === 'from' || name === 'to') {
    return { kind: 'period' };
  }
  if (LOOKUP_FILTERS[name]) {
    return { kind: 'lookup', ...LOOKUP_FILTERS[name] };
  }
  if (name === 'status' || name === 'type') {
    const values = ENUMS[name][reportKey];
    if (values) {
      return { kind: 'enum', values };
    }
  }
  if (Array.isArray(ENUMS[name])) {
    return { kind: 'enum', values: ENUMS[name] };
  }
  if (CHECKBOX_FILTERS.has(name) || type === 'boolean') {
    return { kind: 'checkbox' };
  }
  if (name === 'page') {
    return { kind: 'page' };
  }
  if (name === 'limit') {
    return { kind: 'limit' };
  }
  if (type === 'date') {
    return { kind: 'date' };
  }
  return { kind: 'text' };
}

export function reportFilterDefault(reportKey, filterName, today = '') {
  if (filterName === 'asOf') return today;
  if (filterName === 'page') return '1';
  if (filterName === 'limit') return '50';
  if (CHECKBOX_FILTERS.has(filterName)) return 'false';
  return REPORT_DEFAULTS[reportKey]?.[filterName] ?? '';
}

export function canLoadReportLookup(role, filterName) {
  return Boolean(LOOKUP_FILTERS[filterName] && LOOKUP_ROLES.includes(role));
}

export function reportLookupItemTypes(reportKey, filterName) {
  const lookup = LOOKUP_FILTERS[filterName];
  if (!lookup) {
    return null;
  }
  if (lookup.itemType) {
    return [lookup.itemType];
  }
  if (filterName === 'itemId' && reportKey === 'sales-by-product') {
    return ['FINISHED'];
  }
  if (filterName === 'itemId' && reportKey === 'purchase-register') {
    return ['RAW', 'PACKAGING'];
  }
  return null;
}

export function reportLookupOptionLabel(filterName, entry) {
  const name = entry.name ?? entry.businessName ?? entry.displayName ?? entry.id;
  const code = filterName === 'customerId' ? null : entry.code;
  return [code, name].filter(Boolean).join(' — ');
}

export function reportFilterLabel(filter) {
  const specialLabels = {
    asOf: 'As of',
    customerId: 'Customer',
    customerType: 'Customer type',
    finishedItemId: 'Finished item',
    flaggedOnly: 'Flagged only',
    hideEmpty: 'Hide empty',
    itemId: 'Item',
    supplierId: 'Supplier',
    taxType: 'Tax type',
    type: 'Item type'
  };
  return specialLabels[filter.name]
    ?? filter.name.replace(/([A-Z])/g, ' $1').replace(/^./, (letter) => letter.toUpperCase());
}

export function reportEnumLabel(value) {
  if (value === 'ALL') {
    return 'All';
  }
  return value.toLowerCase().replace(/(^|_)([a-z])/g, (match, separator, letter) => (
    `${separator ? ' ' : ''}${letter.toUpperCase()}`
  ));
}
