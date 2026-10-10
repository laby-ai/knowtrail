import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { NextRequest } from "next/server";
async function main() {
  const keys = [
    "ACCOUNT_CENTER_API_BASE",
    "ACCOUNT_CENTER_APP_KEY",
    "ACCOUNT_CENTER_CREDENTIAL_KEY",
    "ACCOUNT_CENTER_CLIENT_SECRET",
    "ACCOUNT_CENTER_TENANT_ID",
    "ARK_API_BASE",
    "ARK_API_KEY",
    "ARK_MODEL",
  ];
  const previous = Object.fromEntries(
      keys.map((key) => [key, process.env[key]]),
    ),
    originalFetch = globalThis.fetch;
  Object.assign(process.env, {
    ACCOUNT_CENTER_API_BASE: "http://review-account.fixture",
    ACCOUNT_CENTER_APP_KEY: "fixture-app",
    ACCOUNT_CENTER_CREDENTIAL_KEY: "fixture-credential",
    ACCOUNT_CENTER_CLIENT_SECRET: "fixture-secret-not-real",
    ACCOUNT_CENTER_TENANT_ID: "wrong-tenant",
    ARK_API_BASE: "https://platform.invalid",
    ARK_API_KEY: "fixture-platform-not-real",
    ARK_MODEL: "fixture-platform-model",
  });
  let mismatch = false,
    emptyKey = false,
    reservedTenant = "";
  globalThis.fetch = async (url, options) => {
    const pathname = new URL(String(url)).pathname;
    assert.equal(new URL(String(url)).origin, "http://review-account.fixture");
    if (pathname === "/v1/auth/me")
      return Response.json({
        tenant_id: "correct-tenant",
        tenant_name: "QA",
        member: {
          id: "correct-member",
          email: "member@example.invalid",
          display_name: "QA member",
          role_key: "member",
          status: "active",
        },
      });
    const body = JSON.parse(String(options?.body));
    if (pathname === "/v1/internal/provider-key-profile/resolve") {
      assert.equal(body.tenant_id, "correct-tenant");
      assert.equal(body.member_id, "correct-member");
      return Response.json({
        tenant_id: "correct-tenant",
        member_id: mismatch ? "other-member" : "correct-member",
        provider_id: "aliyun-bailian",
        region: "cn-beijing",
        workspace_id: "fixture-workspace",
        text_model: "qwen3.7-plus",
        image_model: "wan2.7-image-pro",
        tts_model: "qwen-audio-3.0-tts-plus",
        api_key: emptyKey ? "" : "fixture-member-not-real",
      });
    }
    if (pathname.endsWith("/usage-reservations")) {
      assert.equal(pathname, '/v1/tenants/correct-tenant/members/correct-member/usage-reservations');
      reservedTenant = pathname.split('/')[3];
      return Response.json({
        reservation: { id: "fixture-reservation", status: "reserved" },
      });
    }
    if (pathname.endsWith("/release")) return Response.json({ ok: true });
    throw new Error("Unexpected fixture route " + pathname);
  };
  try {
    const { resolveCitationReviewConfig } = await import(
      "../src/lib/citation-review-config"
    );
    const { reserveAIUsage } = await import("../src/lib/account-ai-billing");
    const request = new NextRequest(
      "http://localhost/api/research/citation-verification",
      { headers: { Authorization: "Bearer fixture-user" } },
    );
    const config = await resolveCitationReviewConfig(request);
    assert.equal(
      config.apiBase,
      "https://dashscope.aliyuncs.com/compatible-mode/v1",
    );
    assert.equal(config.apiKey, "fixture-member-not-real");
    assert.equal(config.model, "qwen3.7-plus");
    assert.notEqual(config.apiKey, process.env.ARK_API_KEY);
    mismatch = true;
    await assert.rejects(
      resolveCitationReviewConfig(request),
      /scope_mismatch/,
    );
    mismatch = false;
    emptyKey = true;
    await assert.rejects(resolveCitationReviewConfig(request));
    const reservation = await reserveAIUsage({
      route: "citation-account-scope-test",
      tenantId: "correct-tenant",
      memberId: "correct-member",
      modelName: "qwen3.7-plus",
      inputText: "fixture only",
      idempotencyKey: randomUUID(),
    });
    assert(reservation);
    assert.equal(reservedTenant, "correct-tenant");
    await reservation.release();
    console.log(
      "PASS: canonical member/tenant profile, platform-credential isolation, profile mismatch/missing key rejection and tenant-correct billing",
    );
  } finally {
    globalThis.fetch = originalFetch;
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}
void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
