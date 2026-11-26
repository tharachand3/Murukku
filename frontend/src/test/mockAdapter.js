import { AxiosError, AxiosHeaders } from 'axios';

function parseData(data) {
  if (typeof data !== 'string') {
    return data;
  }
  try {
    return JSON.parse(data);
  } catch {
    return data;
  }
}

function requestHeaders(headers) {
  return typeof headers?.toJSON === 'function' ? headers.toJSON() : { ...headers };
}

function routePath(config) {
  const url = String(config.url ?? '/');
  const [path, query] = url.split('?', 2);
  const params = config.params;
  if (!params || typeof params !== 'object') {
    return { path, full: query ? `${path}?${query}` : path };
  }

  const search = new URLSearchParams(query ?? '');
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null) {
      continue;
    }
    if (Array.isArray(value)) {
      value.forEach((entry) => search.append(`${key}[]`, String(entry)));
    } else {
      search.set(key, String(value));
    }
  }
  const suffix = search.toString();
  return { path, full: suffix ? `${path}?${suffix}` : path };
}

function responseFrom(result, config) {
  const responseShape = result && typeof result === 'object'
    && Object.hasOwn(result, 'status')
    && Object.hasOwn(result, 'data');
  const status = responseShape ? result.status : 200;
  const data = responseShape ? result.data : result;
  const headers = AxiosHeaders.from(responseShape ? result.headers : undefined);
  const response = {
    status,
    statusText: '',
    data,
    headers,
    config,
    request: null
  };

  if (status < 200 || status >= 300) {
    const code = status >= 500 ? AxiosError.ERR_BAD_RESPONSE : AxiosError.ERR_BAD_REQUEST;
    throw new AxiosError(`Request failed with status code ${status}`, code, config, null, response);
  }
  return response;
}

export function createMockAdapter(routes = {}) {
  const calls = [];
  const routeEntries = Object.entries(routes).map(([key, handler]) => {
    const splitAt = key.indexOf(' ');
    const method = key.slice(0, splitAt).toLowerCase();
    const path = key.slice(splitAt + 1);
    return { key, method, path, handler };
  });

  const adapter = async (config) => {
    const method = String(config.method ?? 'get').toLowerCase();
    const { path, full } = routePath(config);
    const match = routeEntries.find((route) => (
      route.method === method && (route.path.includes('?')
        ? route.path === full
        : route.path === path)
    ));
    const call = {
      method,
      url: config.url,
      params: config.params,
      data: parseData(config.data),
      headers: requestHeaders(config.headers)
    };
    calls.push(call);

    if (!match) {
      throw new Error(`No mock for ${method.toUpperCase()} ${path}`);
    }
    const result = typeof match.handler === 'function'
      ? await match.handler(config)
      : match.handler;
    return responseFrom(result, config);
  };
  adapter.calls = calls;
  return adapter;
}

export function installMock(api, routes = {}) {
  const adapter = createMockAdapter(routes);
  api.defaults.adapter = adapter;
  return { calls: adapter.calls };
}

export function mockNetworkError() {
  return Promise.reject(new AxiosError(
    'Network Error',
    AxiosError.ERR_NETWORK
  ));
}
