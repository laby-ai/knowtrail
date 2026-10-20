import assert from 'node:assert/strict';
import { getAccountCenterStatus } from '../src/lib/account-center';

const previous = { ...process.env };
try {
  process.env.PAPER_HOST_SESSION_VERIFY_URL = 'https://phone-session.example.invalid/verify';
  delete process.env.ACCOUNT_CENTER_API_BASE;
  assert.equal(getAccountCenterStatus().paperHostLoginHref, '/research-agent', 'Verified phone deployments must hand login to the existing platform entry');

  process.env.ACCOUNT_CENTER_API_BASE = 'https://account.example.invalid';
  assert.equal(getAccountCenterStatus().paperHostLoginHref, '/research-agent', 'An old email configuration cannot replace the authoritative phone session');

  delete process.env.PAPER_HOST_SESSION_VERIFY_URL;
  assert.equal(getAccountCenterStatus().paperHostLoginHref, null);
  assert.equal(getAccountCenterStatus().apiBaseConfigured, true, 'Standalone account-center login remains available when configured');

  delete process.env.ACCOUNT_CENTER_API_BASE;
  assert.equal(getAccountCenterStatus().paperHostLoginHref, null);
  assert.equal(getAccountCenterStatus().apiBaseConfigured, false, 'Unconfigured login must not be advertised as usable');
  console.log('Login entry follows the configured phone authority while preserving standalone account-center deployments.');
} finally {
  for (const key of Object.keys(process.env)) if (!(key in previous)) delete process.env[key];
  Object.assign(process.env, previous);
}
