const installed = new WeakMap();

export function installApiInterceptors(api, { getToken, onUnauthorized }) {
  if (installed.has(api)) {
    const existing = installed.get(api);
    existing.getToken = getToken;
    existing.onUnauthorized = onUnauthorized;
    return existing;
  }

  const record = { getToken, onUnauthorized, requestId: null, responseId: null };
  const requestId = api.interceptors.request.use((config) => {
    const token = record.getToken();
    if (token) {
      config.headers = config.headers ?? {};
      if (typeof config.headers.set === 'function') {
        config.headers.set('Authorization', `Bearer ${token}`);
      } else {
        config.headers.Authorization = `Bearer ${token}`;
      }
    }
    return config;
  });
  const responseId = api.interceptors.response.use(
    (response) => response,
    (error) => {
      const requestUrl = String(error?.config?.url ?? '').split('?')[0];
      if (error?.response?.status === 401 && !requestUrl.endsWith('/auth/login')) {
        record.onUnauthorized();
      }
      return Promise.reject(error);
    }
  );
  record.requestId = requestId;
  record.responseId = responseId;
  installed.set(api, record);
  return record;
}
