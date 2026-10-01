export type AccountCenterStatus = {
  configured: boolean;
  publicUrl: string | null;
  apiBaseConfigured: boolean;
  tenantIdConfigured: boolean;
  memberBindingConfigured: boolean;
  appSignatureConfigured: boolean;
  authRequired: boolean;
  billingReservationReady: boolean;
  billingMode: 'not_configured' | 'portal_only' | 'reservation_ready';
};

function envValue(...names: string[]): string {
  for (const name of names) {
    const value = process.env[name]?.trim();
    if (value) return value;
  }
  return '';
}

export function getAccountCenterStatus(): AccountCenterStatus {
  const publicUrl = envValue('ACCOUNT_CENTER_PUBLIC_URL', 'NEXT_PUBLIC_ACCOUNT_CENTER_URL');
  const apiBaseConfigured = Boolean(envValue('ACCOUNT_CENTER_API_BASE'));
  const tenantIdConfigured = Boolean(envValue('ACCOUNT_CENTER_TENANT_ID'));
  const memberBindingConfigured = Boolean(envValue('ACCOUNT_CENTER_DEFAULT_MEMBER_ID'));
  const authRequired = process.env.ACCOUNT_CENTER_REQUIRE_AUTH?.trim().toLowerCase() === 'true';
  const appSignatureConfigured = Boolean(
    envValue('ACCOUNT_CENTER_APP_KEY') &&
    envValue('ACCOUNT_CENTER_CREDENTIAL_KEY') &&
    envValue('ACCOUNT_CENTER_CLIENT_SECRET')
  );
  const billingReservationReady = apiBaseConfigured && tenantIdConfigured && appSignatureConfigured && (memberBindingConfigured || authRequired);

  return {
    configured: Boolean(publicUrl) || apiBaseConfigured,
    publicUrl: publicUrl || null,
    apiBaseConfigured,
    tenantIdConfigured,
    memberBindingConfigured,
    appSignatureConfigured,
    authRequired,
    billingReservationReady,
    billingMode: billingReservationReady ? 'reservation_ready' : publicUrl ? 'portal_only' : 'not_configured',
  };
}
