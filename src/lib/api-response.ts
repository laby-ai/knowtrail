/** Never expose proxy HTML as a JSON syntax error or downloadable artifact. */
export function responseFailureMessage(status: number, operation: string): string {
  if (status === 413) return `${operation}请求中的资料过大，请减少所选资料后重试（HTTP 413）。`;
  if (status === 502 || status === 503) return `${operation}服务暂时不可用，请稍后重试（HTTP ${status}）。`;
  if (status === 504 || status === 408) return `${operation}等待超时，服务端可能仍在处理。请先确认任务状态，避免重复生成（HTTP ${status}）。`;
  if (status === 401 || status === 403) return `${operation}未获授权，请重新登录或检查账号权限（HTTP ${status}）。`;
  return `${operation}接口返回异常（HTTP ${status}），请稍后重试。`;
}

export async function readApiJson(response: Response, operation: string): Promise<Record<string, unknown>> {
  let value: unknown;
  try { value = JSON.parse(await response.text()); }
  catch { throw new Error(responseFailureMessage(response.status, operation)); }
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(responseFailureMessage(response.status, operation));
  const record = value as Record<string, unknown>;
  if (!response.ok) throw new Error(typeof record.error === 'string' ? record.error : responseFailureMessage(response.status, operation));
  return record;
}

export async function verifyPptxResponse(response: Response): Promise<Blob> {
  if (!response.ok) { await readApiJson(response, 'PPT 生成'); throw new Error('PPT 生成失败。'); }
  const type = response.headers.get('content-type') || '';
  if (!/application\/(?:vnd\.openxmlformats-officedocument\.presentationml\.presentation|octet-stream)/i.test(type)) {
    throw new Error('PPT 生成接口未返回演示文稿文件，请稍后重试。');
  }
  const blob = await response.blob();
  const signature = new Uint8Array(await blob.slice(0, 4).arrayBuffer());
  if (signature.length !== 4 || signature[0] !== 0x50 || signature[1] !== 0x4b || signature[2] !== 3 || signature[3] !== 4) throw new Error('返回的 PPT 文件不完整，请稍后重试。');
  return blob;
}
