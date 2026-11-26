const NETWORK_MESSAGE = 'Cannot reach the server. Check your connection.';

export function toApiError(error) {
  if (error?.response) {
    const { status, data } = error.response;
    const envelope = data?.error;
    if (envelope && typeof envelope === 'object') {
      return {
        status,
        code: envelope.code ?? 'UNKNOWN',
        message: envelope.message ?? 'Request failed',
        details: envelope.details ?? null,
        isNetwork: false,
        isUnauthorized: status === 401
      };
    }
    return {
      status,
      code: 'UNKNOWN',
      message: error.message ?? 'Request failed',
      details: null,
      isNetwork: false,
      isUnauthorized: status === 401
    };
  }
  if (error?.isAxiosError && !error.response) {
    return {
      status: null,
      code: 'NETWORK',
      message: NETWORK_MESSAGE,
      details: null,
      isNetwork: true,
      isUnauthorized: false
    };
  }
  return {
    status: null,
    code: 'UNKNOWN',
    message: error?.message ?? 'Something went wrong',
    details: null,
    isNetwork: false,
    isUnauthorized: false
  };
}

export function fieldErrors(details) {
  const issues = Array.isArray(details) ? details : details?.issues;
  if (!Array.isArray(issues)) {
    return {};
  }
  return issues.reduce((fields, issue) => {
    if (typeof issue?.path === 'string' && typeof issue.message === 'string') {
      const path = issue.path.replace(/^(body|query|params)\./, '');
      fields[path] = issue.message;
    }
    return fields;
  }, {});
}
