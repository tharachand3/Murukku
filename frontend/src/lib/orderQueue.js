import { toApiError } from './apiError.js';

const STORAGE_KEY = 'oda.orderQueue';
const initializedStorages = new WeakSet();
const CLIENT_REF_PATTERN = /^[A-Za-z0-9_-]{8,64}$/;
let activeFlush = null;

function resolveStorage(storage) {
  const resolved = storage ?? globalThis.localStorage;
  if (!resolved || typeof resolved.getItem !== 'function' || typeof resolved.setItem !== 'function') {
    throw new TypeError('Order queue storage is unavailable');
  }
  return resolved;
}

function isQueueItem(item) {
  return item && typeof item === 'object'
    && typeof item.clientRef === 'string'
    && CLIENT_REF_PATTERN.test(item.clientRef)
    && typeof item.createdAt === 'string'
    && !Number.isNaN(Date.parse(item.createdAt))
    && new Date(item.createdAt).toISOString() === item.createdAt
    && Number.isSafeInteger(item.customerId) && item.customerId > 0
    && typeof item.customerName === 'string'
    && Array.isArray(item.lines)
    && item.lines.every((line) => line && Number.isSafeInteger(line.itemId) && line.itemId > 0
      && typeof line.name === 'string' && Number.isSafeInteger(line.qty)
      && line.qty > 0 && line.qty <= 100000)
    && typeof item.notes === 'string'
    && ['PENDING', 'SENDING', 'FAILED'].includes(item.state)
    && Number.isSafeInteger(item.attempts) && item.attempts >= 0
    && (item.lastError === null || typeof item.lastError === 'string');
}

function readQueue(storage) {
  const target = resolveStorage(storage);
  const stored = target.getItem(STORAGE_KEY);
  let items = [];
  let corrupt = false;
  if (stored !== null) {
    try {
      items = JSON.parse(stored);
    } catch {
      corrupt = true;
    }
    if (!Array.isArray(items) || items.some((item) => !isQueueItem(item))) {
      items = [];
      corrupt = true;
    }
  }

  let shouldWrite = corrupt;
  if (!initializedStorages.has(target)) {
    initializedStorages.add(target);
    let changed = false;
    items = items.map((item) => {
      if (item.state !== 'SENDING') return item;
      changed = true;
      return { ...item, state: 'PENDING' };
    });
    shouldWrite = shouldWrite || changed || items.length === 0;
  }
  if (shouldWrite) writeQueue(target, items);
  return items;
}

function writeQueue(storage, items) {
  storage.setItem(STORAGE_KEY, JSON.stringify(items));
}

function updateItem(storage, clientRef, update) {
  const items = readQueue(storage);
  const index = items.findIndex((item) => item.clientRef === clientRef);
  if (index < 0) return false;
  items[index] = update(items[index]);
  writeQueue(storage, items);
  return true;
}

function validCreatedAt(now) {
  const date = now instanceof Date ? now : new Date(now);
  if (Number.isNaN(date.getTime())) {
    throw new TypeError('A valid queue creation date is required');
  }
  return date.toISOString();
}

export function createClientRef() {
  const id = globalThis.crypto?.randomUUID?.()
    ?? `oda_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 14)}`;
  if (!CLIENT_REF_PATTERN.test(id)) {
    throw new Error('Unable to generate a valid order clientRef');
  }
  return id;
}

export function enqueue(order, storage, now = new Date()) {
  if (!order || typeof order !== 'object' || !Number.isSafeInteger(order.customerId)
    || !Array.isArray(order.lines)) {
    throw new TypeError('A valid order is required for the offline queue');
  }
  const target = resolveStorage(storage);
  const clientRef = order.clientRef ?? createClientRef();
  if (!CLIENT_REF_PATTERN.test(clientRef)) {
    throw new TypeError('clientRef must contain 8-64 letters, numbers, underscores, or hyphens');
  }
  const items = readQueue(target);
  const existing = items.find((item) => item.clientRef === clientRef);
  if (existing) return existing;

  const item = {
    clientRef,
    createdAt: validCreatedAt(now),
    customerId: order.customerId,
    customerName: String(order.customerName ?? ''),
    lines: order.lines.map((line) => ({
      itemId: line.itemId,
      name: String(line.name ?? ''),
      qty: line.qty
    })),
    notes: String(order.notes ?? ''),
    state: 'PENDING',
    attempts: 0,
    lastError: null
  };
  if (!isQueueItem(item)) {
    throw new TypeError('Offline order contains invalid line data');
  }
  writeQueue(target, [...items, item]);
  return item;
}

export function list(storage) {
  return readQueue(resolveStorage(storage));
}

export function remove(clientRef, storage) {
  const target = resolveStorage(storage);
  const items = readQueue(target);
  const remaining = items.filter((item) => item.clientRef !== clientRef);
  if (remaining.length === items.length) return false;
  writeQueue(target, remaining);
  return true;
}

export function discardFailed(clientRef, storage) {
  const target = resolveStorage(storage);
  const items = readQueue(target);
  const item = items.find((entry) => entry.clientRef === clientRef);
  if (!item || item.state !== 'FAILED') return false;
  writeQueue(target, items.filter((entry) => entry.clientRef !== clientRef));
  return true;
}

function requestBody(item) {
  return {
    customerId: item.customerId,
    clientRef: item.clientRef,
    ...(item.notes ? { notes: item.notes } : {}),
    lines: item.lines.map(({ itemId, qty }) => ({ itemId, qty }))
  };
}

export function flush(api, storage) {
  if (activeFlush) return activeFlush;
  if (!api || typeof api.post !== 'function') {
    throw new TypeError('An API client with a post method is required');
  }
  const target = resolveStorage(storage);

  activeFlush = (async () => {
    let sent = 0;
    let failed = 0;
    const pending = readQueue(target).filter((item) => item.state === 'PENDING');

    for (const item of pending) {
      updateItem(target, item.clientRef, (current) => ({
        ...current,
        state: 'SENDING',
        attempts: current.attempts + 1,
        lastError: null
      }));
      try {
        await api.post('/orders', requestBody(item));
        remove(item.clientRef, target);
        sent += 1;
      } catch (error) {
        if (!error?.response) {
          updateItem(target, item.clientRef, (current) => ({
            ...current,
            state: 'PENDING'
          }));
          break;
        }
        const message = toApiError(error).message;
        updateItem(target, item.clientRef, (current) => ({
          ...current,
          state: 'FAILED',
          lastError: message
        }));
        failed += 1;
      }
    }

    return { sent, failed, remaining: readQueue(target).length };
  })().finally(() => {
    activeFlush = null;
  });
  return activeFlush;
}
