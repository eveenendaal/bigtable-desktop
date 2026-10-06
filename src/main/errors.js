// Turns client errors into messages with actionable hints.

const GRPC_CODES = {
  1: 'CANCELLED',
  2: 'UNKNOWN',
  3: 'INVALID_ARGUMENT',
  4: 'DEADLINE_EXCEEDED',
  5: 'NOT_FOUND',
  7: 'PERMISSION_DENIED',
  8: 'RESOURCE_EXHAUSTED',
  12: 'UNIMPLEMENTED',
  14: 'UNAVAILABLE',
  16: 'UNAUTHENTICATED',
};

export function describeError(err) {
  const message = String(err?.details || err?.message || err || 'Unknown error');
  const code = typeof err?.code === 'number' ? GRPC_CODES[err.code] || String(err.code) : err?.code;
  let hint;
  if (/Could not load the default credentials|default credentials|invalid_grant|reauth|invalid_rapt/i.test(message) || code === 'UNAUTHENTICATED') {
    hint = 'Sign in with Application Default Credentials: run `gcloud auth application-default login` and try again.';
  } else if (code === 'PERMISSION_DENIED') {
    hint =
      'Your account lacks a permission for this call. Listing needs roles/bigtable.viewer; reading data needs roles/bigtable.reader. ' +
      'You can still add instances and tables by ID from the sidebar.';
  } else if (code === 'UNIMPLEMENTED') {
    hint = 'This endpoint does not support the call (the Bigtable emulator does not support listing instances or GoogleSQL).';
  } else if (code === 'UNAVAILABLE' || /ECONNREFUSED|ENOTFOUND/.test(message)) {
    hint = 'Could not reach Bigtable. Check your network connection or emulator host.';
  } else if (/quota project|SERVICE_DISABLED|has not been used in project/i.test(message)) {
    hint = 'Enable the Bigtable and Cloud Resource Manager APIs, or set a quota project with `gcloud auth application-default set-quota-project`.';
  }
  return { message, code: code ?? null, hint: hint ?? null };
}
