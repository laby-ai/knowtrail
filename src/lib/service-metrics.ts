type MetricKey = string;

const METHODS = new Set(['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS', 'HEAD']);
const STATES = new Set(['queued', 'running', 'started', 'succeeded', 'failed', 'cancelled']);
const OPERATIONS = new Set(['grounded_task', 'model_provider']);

function labels(values: Record<string, string>): string {
  return Object.keys(values).sort().map(key => `${key}="${values[key]}"`).join(',');
}

function headerPresent(value: string | string[] | undefined): boolean {
  return Array.isArray(value) ? value.some(item => item.trim()) : Boolean(value?.trim());
}

export function trustedMetricsRequest(
  remoteAddress: string | undefined,
  forwardedFor: string | string[] | undefined,
  realIp: string | string[] | undefined,
): boolean {
  if (headerPresent(forwardedFor) || headerPresent(realIp)) return false;
  const address = (remoteAddress || '').replace(/^::ffff:/, '');
  if (address === '::1' || address === '127.0.0.1') return true;
  const parts = address.split('.').map(Number);
  if (parts.length !== 4 || parts.some(part => !Number.isInteger(part) || part < 0 || part > 255)) return false;
  return parts[0] === 10
    || (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31)
    || (parts[0] === 192 && parts[1] === 168);
}

export function metricsRoute(target: string): string {
  let path = '/';
  try { path = new URL(target || '/', 'http://localhost').pathname; } catch {}
  if (path === '/api/health') return '/api/health';
  if (path === '/api/metrics') return '/api/metrics';
  if (path.startsWith('/api/ai/')) return '/api/ai';
  if (path.startsWith('/api/account/')) return '/api/account';
  if (path.startsWith('/api/')) return '/api';
  if (path.startsWith('/uploads/') || path.startsWith('/mineru-figures/')) return '/runtime-file';
  if (path === '/' || path.startsWith('/workbench')) return '/ui';
  return '/unmatched';
}

export class ServiceMetrics {
  private readonly http = new Map<MetricKey, number>();
  private readonly httpDuration = new Map<MetricKey, { count: number; sum: number }>();
  private readonly operations = new Map<MetricKey, number>();
  private readonly operationDuration = new Map<MetricKey, { count: number; sum: number }>();

  constructor(private readonly service: string) {}

  observeHttp(method: string, route: string, status: number, durationSeconds: number) {
    const safeMethod = METHODS.has(method.toUpperCase()) ? method.toUpperCase() : 'OTHER';
    const safeRoute = metricsRoute(route);
    const statusClass = `${Math.max(0, Math.min(9, Math.floor(status / 100)))}xx`;
    const key = JSON.stringify([safeMethod, safeRoute, statusClass]);
    this.http.set(key, (this.http.get(key) || 0) + 1);
    const durationKey = JSON.stringify([safeMethod, safeRoute]);
    const current = this.httpDuration.get(durationKey) || { count: 0, sum: 0 };
    this.httpDuration.set(durationKey, { count: current.count + 1, sum: current.sum + Math.max(0, durationSeconds) });
  }

  observeOperation(operation: string, state: string, durationSeconds?: number) {
    const safeOperation = OPERATIONS.has(operation) ? operation : 'unknown';
    const safeState = STATES.has(state) ? state : 'unknown';
    const key = JSON.stringify([safeOperation, safeState]);
    this.operations.set(key, (this.operations.get(key) || 0) + 1);
    if (typeof durationSeconds === 'number') {
      const current = this.operationDuration.get(key) || { count: 0, sum: 0 };
      this.operationDuration.set(key, { count: current.count + 1, sum: current.sum + Math.max(0, durationSeconds) });
    }
  }

  render(): string {
    const lines = [
      '# HELP stoneai_http_requests_total Completed HTTP requests.',
      '# TYPE stoneai_http_requests_total counter',
    ];
    for (const [key, value] of [...this.http].sort()) {
      const [method, route, statusClass] = JSON.parse(key);
      lines.push(`stoneai_http_requests_total{${labels({ method, route, service: this.service, status_class: statusClass })}} ${value}`);
    }
    lines.push('# HELP stoneai_http_request_duration_seconds Request duration in seconds.', '# TYPE stoneai_http_request_duration_seconds summary');
    for (const [key, value] of [...this.httpDuration].sort()) {
      const [method, route] = JSON.parse(key);
      const metricLabels = labels({ method, route, service: this.service });
      lines.push(`stoneai_http_request_duration_seconds_count{${metricLabels}} ${value.count}`);
      lines.push(`stoneai_http_request_duration_seconds_sum{${metricLabels}} ${value.sum.toFixed(6)}`);
    }
    lines.push('# HELP stoneai_operation_events_total Completed operational lifecycle events.', '# TYPE stoneai_operation_events_total counter');
    for (const [key, value] of [...this.operations].sort()) {
      const [operation, state] = JSON.parse(key);
      lines.push(`stoneai_operation_events_total{${labels({ operation, service: this.service, state })}} ${value}`);
    }
    lines.push('# HELP stoneai_operation_duration_seconds Operational duration in seconds.', '# TYPE stoneai_operation_duration_seconds summary');
    for (const [key, value] of [...this.operationDuration].sort()) {
      const [operation, state] = JSON.parse(key);
      const metricLabels = labels({ operation, service: this.service, state });
      lines.push(`stoneai_operation_duration_seconds_count{${metricLabels}} ${value.count}`);
      lines.push(`stoneai_operation_duration_seconds_sum{${metricLabels}} ${value.sum.toFixed(6)}`);
    }
    return `${lines.join('\n')}\n`;
  }
}

export const serviceMetrics = new ServiceMetrics('knowtrail');
export const PROMETHEUS_CONTENT_TYPE = 'text/plain; version=0.0.4; charset=utf-8';

