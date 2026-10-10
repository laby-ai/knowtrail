import type { NextRequest } from "next/server";
import type { RuntimeAIConfig } from "@/types";
import {
  resolveMemberBailianProfile,
  BailianProfileRequiredError,
} from "./bailian-provider-profile";
export async function resolveCitationReviewConfig(
  request: NextRequest,
): Promise<Partial<RuntimeAIConfig>> {
  const profile = await resolveMemberBailianProfile(request);
  if (!profile.api_key?.trim() || !profile.text_model?.trim())
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
