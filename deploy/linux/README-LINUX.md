# Lingbi Studio Linux Deploy Bundle

This bundle is built for a single Linux server. It contains the production Next.js build, the custom Node server, deployment scripts, and env templates.

## Requirements

- Linux x86_64 or arm64 server
- Node.js 20+ and pnpm, or Ubuntu/Debian with root/sudo so `bootstrap-ubuntu.sh` can install them
- Persistent disk mounted at `/opt/lingbi-studio/.data` or another path configured in `.env.production`

## One-command Flow

Ubuntu/Debian single-node quick start:

```bash
tar -xzf lingbi-studio-linux-*.tar.gz
cd lingbi-studio
bash ./deploy.sh
```

Manual flow:

```bash
tar -xzf lingbi-studio-linux-*.tar.gz
cd lingbi-studio
bash ./install.sh
bash ./preflight.sh
nano .env.production
bash ./start.sh
```

For an atomic production release, never rely only on the environment of the currently running process. Prepare the candidate from a stable root-owned env file, start it on a standby port, and promote only after the strict health gate passes:

```bash
node scripts/prepare-release-env.mjs /opt/knowtrail/config/.env.production "$RELEASE_DIR/.env.production"
# Start $RELEASE_DIR on 127.0.0.1:5099 with its own .env.production first.
RELEASE_STANDBY_ORIGIN=http://127.0.0.1:5099 \
RELEASE_STANDBY_PID_FILE=/run/lingbi-standby.pid \
RELEASE_LIVE_ORIGIN=http://127.0.0.1:5000 \
RELEASE_SHARED_ROOT=/opt/knowtrail/shared \
node scripts/promote-release.mjs "$RELEASE_DIR" /opt/knowtrail/current /opt/knowtrail/previous
```

The stable env and candidate `.env.production` must be mode `0600`. The gate reports only variable group names and capability states; it never prints secret values. Failed live verification restores `current` to the previous release and restarts the service.

Open:

```text
http://SERVER_IP:5000
```

Health check:

```bash
bash ./healthcheck.sh
```

## Real Service Smoke

For release validation with a real Ark/OpenAI-compatible provider, copy the private template on the target server and fill it locally:

```bash
cp .env.real.local.example .env.real.local
nano .env.real.local
pnpm smoke:real-openai-compatible
pnpm smoke:real-app-ai
pnpm smoke:real-studio-products
pnpm smoke:real-doubao-tts
pnpm smoke:workbench-studio-ui
pnpm smoke:studio-evidence-ui
pnpm audit:pptx-quality
pnpm smoke:runtime-health
```

Run `pnpm smoke:real-env-preflight` first when validating a server. It reports whether Base URL, model names, TTS speaker, and secret variables are configured, but prints secrets only as `[REDACTED]`.

These smoke tests verify the real text model, optional vision/embedding models, zvec write/query, grounded chat, and right-side Studio products. `smoke:real-studio-products` reports knowledge cards, report, podcast grounded context, Doubao AgentPlan TTS audio, and PPT-v2 as separate PASS/FAIL/SKIP rows with durations and citation metadata. For real podcast audio, fill `AGENTPLAN_TTS_ENDPOINT`, `AGENTPLAN_TTS_RESOURCE_ID=seed-tts-2.0`, `AGENTPLAN_TTS_SPEAKER`, and a private `AGENTPLAN_TTS_API_KEY` in `.env.real.local`. Do not commit or copy `.env.real.local` into shared bundles.

Before shipping a bundle, run `pnpm smoke:linux-package-products` from the source workspace. It checks that the latest `.deploy/lingbi-studio-linux-*.tar.gz` includes the real model, Doubao AgentPlan TTS, right-side Studio, evidence UI, PPTX quality, runtime health, and validation entrypoints; it also verifies that `.env.real.local`, `.data`, `.logs`, `public/uploads`, and `public/mineru-figures` are not archived.

Runtime logs for `./deploy.sh`:

```bash
tail -f logs/server.log
```

`bash ./preflight.sh` is non-invasive: it checks Node.js, pnpm, required build artifacts, `.env.production`, port availability, and writable persistent paths before starting the service. The documented commands use `bash ./script.sh` so bundles created on Windows still work if the tar extraction does not preserve executable bits.

`bash ./install.sh` also runs `pnpm ensure:next-externals`. This recreates Next/Turbopack hashed external package aliases such as `pg-*` and `@zvec/zvec-*` after a clean production install, so the bundle can boot on a server without copying the source workspace `node_modules`.

## systemd

```bash
sudo useradd --system --home /opt/lingbi-studio --shell /usr/sbin/nologin lingbi || true
sudo mkdir -p /opt/lingbi-studio
sudo rsync -a ./ /opt/lingbi-studio/
sudo chown -R lingbi:lingbi /opt/lingbi-studio
sudo cp /opt/lingbi-studio/deploy/linux/lingbi-studio.service /etc/systemd/system/lingbi-studio.service
sudo systemctl daemon-reload
sudo systemctl enable --now lingbi-studio
sudo systemctl status lingbi-studio
```

## Nginx

Copy `deploy/linux/nginx.conf.example`, change `server_name`, then enable HTTPS with your preferred ACME client. Public deployments should use HTTPS for account sessions and uploaded materials.

## Production Notes

- For single-node deployment, keep `SOURCE_STORE_ADAPTER=local-json` and put `SOURCE_STORE_PATH` plus `ZVEC_STORE_PATH` on persistent disk.
- For multi-instance deployment, use `SOURCE_STORE_ADAPTER=postgres` plus `DATABASE_URL`.
- Keep `ALLOW_INSECURE_API_BASE=false` and `ALLOW_PRIVATE_API_BASE=false` on public servers.
- Do not write real API keys into this bundle. C-end model access is account-bound and should use deployment secrets or an approved gateway.
- Use `.env.real.local` only for private server-side smoke tests; it is ignored and should never be archived with real secrets.
