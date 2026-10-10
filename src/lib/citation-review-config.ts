import type { NextRequest } from "next/server";
import type { RuntimeAIConfig } from "@/types";
import { resolveAccountSessionFromRequest } from "./account-session";
import {
  resolveMemberBailianProfile,
  BailianProfileRequiredError,
} from "./bailian-provider-profile";
export async function resolveCitationReviewConfig(
  request: NextRequest,
): Promise<Partial<RuntimeAIConfig>> {
  const session = await resolveAccountSessionFromRequest(request);
  if (!session) throw new BailianProfileRequiredError();
  const profile = await resolveMemberBailianProfile(request);
  if (
    profile.tenant_id !== session.tenant_id ||
    profile.member_id !== session.member.id
  )
    throw new Error("provider_profile_scope_mismatch");
  if (
    !profile.api_key?.trim() ||
    !profile.text_model?.trim() ||
    !profile.workspace_id?.trim() ||
    profile.region !== "cn-beijing"
  )
    throw new BailianProfileRequiredError();
  return {
    apiBase: "https://dashscope.aliyuncs.com/compatible-mode/v1",
    apiKey: profile.api_key,
    model: profile.text_model,
    providerId: profile.provider_id,
    workspaceId: profile.workspace_id,
    region: profile.region,
  };
}
