import {
  PodcastAudioGenerationError,
  classifyPodcastGenerationError,
  generatePodcastSegments,
} from '@/lib/ai-service';
import { buildGroundedRetrievalContext, toRetrievalMetadata } from '@/lib/grounded-retrieval';
import type { RagSourceInput } from '@/lib/rag';
import {
  createStudioJob,
  getStudioJob,
  toStudioJobResponse,
  updateStudioJob,
  type StudioJob,
} from '@/lib/studio-job';
import type { RuntimeAIConfig } from '@/types';

const PODCAST_RETRIEVAL_PROMPT = '生成双人播客脚本，提取核心论点、关键证据、方法、结果和可口播解释，并保留引用依据';

export interface SubmitPodcastJobInput {
  requestedText: string;
  title?: string;
  papers: RagSourceInput[];
  aiConfig?: Partial<RuntimeAIConfig>;
  ownerMemberId?: string;
  notebookId?: string;
}

export async function buildPodcastRetrievalPreview(input: SubmitPodcastJobInput) {
  const grounded = input.papers.length > 0
    ? await buildGroundedRetrievalContext(PODCAST_RETRIEVAL_PROMPT, input.papers, input.aiConfig, {
      topK: 10,
      ownerMemberId: input.ownerMemberId,
      notebookId: input.notebookId,
    })
    : undefined;

  return {
    citations: grounded?.citations ?? [],
    retrieval: grounded ? toRetrievalMetadata(grounded) : {
      mode: 'request-text',
      persistedSourceCount: 0,
      vectorIndexedSourceCount: 0,
      degraded: true,
      reason: '未提供可检索资料，仅使用当前文本生成播客。',
    },
    promptContext: grounded?.promptContext ?? '',
  };
}

function sourceIdentity(source: RagSourceInput): string | undefined {
  return source.id || source.fileName || source.title;
}

function buildPodcastText(input: SubmitPodcastJobInput, promptContext: string): string {
  const groundedContext = promptContext ? `\n\n【检索证据】\n${promptContext}` : '';
  return input.title
    ? `标题：${input.title}\n\n${input.requestedText}${groundedContext}`
    : `${input.requestedText}${groundedContext}`;
}

async function runPodcastJob(jobId: string, podcastText: string, aiConfig?: Partial<RuntimeAIConfig>) {
  try {
    updateStudioJob(jobId, {
      status: 'running',
      stage: 'generating-script',
      progress: 32,
      message: '正在基于检索证据生成播客脚本...',
    });
    updateStudioJob(jobId, {
      status: 'running',
      stage: 'synthesizing-audio',
      progress: 62,
      message: '正在调用豆包语音合成生成播客音频...',
    });

    const result = await generatePodcastSegments(podcastText, {
      ttsSpeaker: aiConfig?.ttsSpeaker,
      runtimeConfig: aiConfig,
    });

    if (!result.audioUrl) {
      throw new PodcastAudioGenerationError('播客 provider 未返回音频地址或可轮询任务。', result.dialogueText || podcastText);
    }

    updateStudioJob(jobId, {
      status: result.audioUrl ? 'succeeded' : 'running',
      stage: result.audioUrl ? 'completed' : 'synthesizing-audio',
      progress: result.audioUrl ? 100 : 82,
      message: result.audioUrl
        ? result.partial
          ? '播客首段音频已生成，部分后续片段需要稍后重试。'
          : '播客音频已生成。'
        : '播客音频任务已提交，正在等待上游完成。',
      artifact: {
        kind: 'audio',
        url: result.audioUrl,
        contentType: 'audio/mpeg',
        meta: {
          provider: result.provider,
          partial: result.partial,
          segments: result.segments,
          dialoguePreview: result.dialogueText?.slice(0, 900),
        },
      },
    });
  } catch (error) {
    const failure = classifyPodcastGenerationError(error);
    updateStudioJob(jobId, {
      status: 'failed',
      stage: 'failed',
      progress: 100,
      message: failure.userMessage,
      error: {
        type: failure.errorType,
        message: failure.userMessage,
        detail: failure.error,
        retryable: failure.retryable,
        requestId: failure.requestId,
        upstreamStatus: failure.upstreamStatus,
      },
      artifact: error instanceof PodcastAudioGenerationError
        ? {
          kind: 'json',
          meta: {
            segments: error.segments,
            dialoguePreview: error.dialogueText.slice(0, 900),
          },
        }
        : undefined,
    });
  }
}

export async function submitPodcastJob(input: SubmitPodcastJobInput): Promise<StudioJob> {
  const preview = await buildPodcastRetrievalPreview(input);
  const job = createStudioJob({
    type: 'podcast',
    ownerMemberId: input.ownerMemberId,
    notebookId: input.notebookId,
    stage: 'retrieving-context',
    progress: 18,
    message: preview.citations.length > 0
      ? '已获取资料引用，正在排队生成播客。'
      : '未获取到资料引用，将基于当前文本生成播客。',
    sourceIds: input.papers.map(sourceIdentity).filter((value): value is string => Boolean(value)),
    citations: preview.citations,
    retrieval: preview.retrieval,
  });

  const podcastText = buildPodcastText(input, preview.promptContext);
  void runPodcastJob(job.id, podcastText, input.aiConfig);
  return job;
}

export function getPodcastStudioJobResponse(jobId: string, scope: { ownerMemberId?: string; notebookId?: string } = {}) {
  const job = getStudioJob(jobId, scope);
  return job ? toStudioJobResponse(job) : undefined;
}
