import http from 'node:http';
import crypto from 'node:crypto';

const PORT = 8088;
const sessions = new Map();

function mockSession(email, displayName) {
  const name = displayName || email.split('@')[0];
  const token = `mock_${crypto.randomUUID()}`;
  const memberId = `mem_${crypto.createHash('sha256').update(email).digest('hex').slice(0, 12)}`;
  const session = {
    token,
    expires_at: new Date(Date.now() + 86400_000).toISOString(),
    tenant_id: 'tenant_dev',
    tenant_name: 'Dev Workspace',
    member: {
      id: memberId,
      display_name: name,
      email,
      role_key: 'member',
      status: 'active',
    },
  };
  sessions.set(token, session);
  return session;
}

function readBody(req) {
  return new Promise((resolve) => {
    let data = '';
    req.on('data', (chunk) => (data += chunk));
    req.on('end', () => resolve(data));
  });
}

const server = http.createServer(async (req, res) => {
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  const url = new URL(req.url, `http://localhost:${PORT}`);

  if (url.pathname === '/v1/auth/login' && req.method === 'POST') {
    const body = JSON.parse(await readBody(req));
    const session = mockSession(body.email);
    res.writeHead(200);
    res.end(JSON.stringify(session));
    return;
  }

  if (url.pathname === '/v1/auth/register' && req.method === 'POST') {
    const body = JSON.parse(await readBody(req));
    const session = mockSession(body.email, body.display_name);
    res.writeHead(200);
    res.end(JSON.stringify(session));
    return;
  }

  if (url.pathname === '/v1/auth/me' && req.method === 'GET') {
    const auth = req.headers.authorization || '';
    if (!auth.startsWith('Bearer ')) {
      res.writeHead(401);
      res.end(JSON.stringify({ error: 'missing_bearer' }));
      return;
    }
    const token = auth.slice(7);
    const session = sessions.get(token);
    if (!session) {
      res.writeHead(401);
      res.end(JSON.stringify({ error: 'invalid_token' }));
      return;
    }
    res.writeHead(200);
    res.end(JSON.stringify(session));
    return;
  }

  if (url.pathname === '/v1/auth/logout' && req.method === 'POST') {
    res.writeHead(200);
    res.end(JSON.stringify({ status: 'ok' }));
    return;
  }

  if (url.pathname === '/v1/auth/password-reset/request' && req.method === 'POST') {
    res.writeHead(200);
    res.end(JSON.stringify({ status: 'sent', message: 'Mock: password reset email sent.' }));
    return;
  }

  res.writeHead(404);
  res.end(JSON.stringify({ error: 'not_found' }));
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`Mock account center running at http://127.0.0.1:${PORT}`);
});
