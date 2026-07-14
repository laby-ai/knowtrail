import { createServer } from 'http';
import { request as httpRequest } from 'http';
import type { IncomingMessage, ServerResponse } from 'http';
import { createReadStream, existsSync } from 'fs';
import { stat } from 'fs/promises';
import path from 'path';
import { parse } from 'url';
import next from 'next';
import { observeRequest } from './lib/request-observability';
import { operationalObservabilityStatus } from './lib/operational-observability';
import { PROMETHEUS_CONTENT_TYPE, serviceMetrics, trustedMetricsRequest } from './lib/service-metrics';
import {
  resolveClassroomProxyTarget,
  shouldProxyMissingClassroomAsset,
} from './lib/virtual-classroom/proxy-target';

const runtimeEnv = process.env.APP_RUNTIME_ENV || process.env.NODE_ENV || 'production';
const dev = runtimeEnv !== 'production';
const operationalObservability = operationalObservabilityStatus();
if (!dev && !operationalObservability.ready) {
  console.error(JSON.stringify({
    timestamp: new Date().toISOString(),
    level: 'error',
    service: 'knowtrail',
    event: 'startup_blocked',
    blocker: operationalObservability.blockers[0],
    exitCode: 78,
  }));
  process.exit(78);
}
const bindHost = process.env.BIND_HOST || (dev ? 'localhost' : '127.0.0.1');
const port = parseInt(process.env.PORT || '5000', 10);

// Create Next.js app
const app = next({ dev, hostname: bindHost, port });
const handle = app.getRequestHandler();

const publicDir = path.resolve(process.cwd(), 'public');
const mainNextStaticDir = path.resolve(process.cwd(), '.next', 'static');
const runtimePublicPrefixes = ['/uploads/', '/mineru-figures/'];
const classroomRuntimeOrigin = (process.env.VIRTUAL_CLASSROOM_INTERNAL_ORIGIN || '').trim().replace(/\/$/, '');
const mimeTypes: Record<string, string> = {
  '.aac': 'audio/aac',
  '.gif': 'image/gif',
  '.jpeg': 'image/jpeg',
  '.jpg': 'image/jpeg',
  '.m4a': 'audio/mp4',
  '.mp3': 'audio/mpeg',
  '.mp4': 'video/mp4',
  '.pdf': 'application/pdf',
  '.png': 'image/png',
  '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  '.txt': 'text/plain; charset=utf-8',
  '.wav': 'audio/wav',
  '.webp': 'image/webp',
};

function resolveRuntimePublicPath(pathname: string): string | null {
  if (!runtimePublicPrefixes.some(prefix => pathname.startsWith(prefix))) return null;

  let decodedPathname: string;
  try {
    decodedPathname = decodeURIComponent(pathname);
  } catch {
    return null;
  }

  const relativePath = decodedPathname.replace(/^\/+/, '');
  const absolutePath = path.resolve(publicDir, relativePath);
  const relativeToPublic = path.relative(publicDir, absolutePath);
  if (relativeToPublic.startsWith('..') || path.isAbsolute(relativeToPublic)) return null;
  return absolutePath;
}

function proxyClassroomRuntime(
  req: IncomingMessage,
  res: ServerResponse,
  pathname: string,
  onError: (error: unknown) => void,
): boolean {
  if (!classroomRuntimeOrigin) return false;

  const proxyTarget = resolveClassroomProxyTarget(req.url || pathname, pathname);
  const missingClassroomAsset = shouldProxyMissingClassroomAsset(pathname, mainNextStaticDir, existsSync);
  if (!proxyTarget.shouldProxy && !missingClassroomAsset) return false;

  const targetPath = proxyTarget.shouldProxy ? proxyTarget.targetPath : req.url || pathname;
  const target = new URL(targetPath, `${classroomRuntimeOrigin}/`);
  const headers = { ...req.headers };
  delete headers.host;
  delete headers.connection;

  const proxyReq = httpRequest(target, {
    method: req.method,
    headers,
  }, proxyRes => {
    res.statusCode = proxyRes.statusCode || 502;
    for (const [key, value] of Object.entries(proxyRes.headers)) {
      if (typeof value !== 'undefined') res.setHeader(key, value);
    }
    proxyRes.pipe(res);
  });

  proxyReq.on('error', error => {
    onError(error);
    if (!res.headersSent) res.statusCode = 502;
    res.end('Classroom runtime unavailable');
  });

  req.pipe(proxyReq);
  return true;
}

app.prepare().then(() => {
  const server = createServer(async (req, res) => {
    const observation = observeRequest(req, res);
    try {
      const parsedUrl = parse(req.url!, true);
      const pathname = parsedUrl.pathname || '';
      if (pathname === '/api/metrics') {
        if (!trustedMetricsRequest(req.socket.remoteAddress, req.headers['x-forwarded-for'], req.headers['x-real-ip'])) {
          res.statusCode = 403;
          res.setHeader('Content-Type', 'application/json; charset=utf-8');
          res.end(JSON.stringify({ error: 'metrics_forbidden' }));
          return;
        }
        const body = serviceMetrics.render();
        res.statusCode = 200;
        res.setHeader('Content-Type', PROMETHEUS_CONTENT_TYPE);
        res.setHeader('Cache-Control', 'no-store');
        res.setHeader('X-Content-Type-Options', 'nosniff');
        res.end(body);
        return;
      }
      if (proxyClassroomRuntime(req, res, pathname, observation.logError)) return;

      const runtimeFilePath = resolveRuntimePublicPath(pathname);
      if (runtimeFilePath && (req.method === 'GET' || req.method === 'HEAD')) {
        const fileStat = await stat(runtimeFilePath).catch(() => null);
        if (fileStat?.isFile()) {
          const contentType = mimeTypes[path.extname(runtimeFilePath).toLowerCase()] || 'application/octet-stream';
          res.statusCode = 200;
          res.setHeader('Content-Type', contentType);
          res.setHeader('Content-Length', String(fileStat.size));
          res.setHeader('Cache-Control', 'public, max-age=3600');
          if (req.method === 'HEAD') {
            res.end();
            return;
          }
          createReadStream(runtimeFilePath)
            .on('error', error => {
              observation.logError(error);
              if (!res.headersSent) res.statusCode = 500;
              res.end();
            })
            .pipe(res);
          return;
        }
      }
      await handle(req, res, parsedUrl);
    } catch (err) {
      observation.logError(err);
      res.statusCode = 500;
      res.end('Internal server error');
    }
  });
  server.once('error', err => {
    console.error(err);
    process.exit(1);
  });
  server.listen(port, bindHost, () => {
    console.log(
      `> Server listening at http://${bindHost}:${port} as ${
        dev ? 'development' : 'production'
      }`,
    );
  });
});
