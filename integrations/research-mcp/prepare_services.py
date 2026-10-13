"""Reuse audited upstreams in private Lingbi services, outside marketplace billing.

Run on the deployment server. Never copy credentials or customer state into Git.
"""
import json
import os
from pathlib import Path
import secrets
import subprocess
import shutil
from dotenv import dotenv_values

PRODUCTS = {"external-labmate": 9307, "external-pubcrawl": 9308,
            "external-prisma": 9309, "paper-search": 9301, "papercheck": 9310}
TECHNICAL = {"UPSTREAM_PYTHON", "UPSTREAM_COMMAND", "UPSTREAM_ARGS_JSON",
             "UPSTREAM_ENV_JSON", "UPSTREAM_NODE_DIR", "UPSTREAM_TIMEOUT_SECONDS"}


def read_env(path):
    return {key: value for key, value in dotenv_values(path, interpolate=False).items() if value is not None}


def write_env(path, values):
    path.write_text("".join(f"{key}={json.dumps(value)}\n" for key, value in values.items()))
    os.chmod(path, 0o600)


def main():
    root = Path("/opt/sci-research-mcp")
    if not (root / ".venv/bin/python").is_file():
        raise RuntimeError("audited scientific MCP runtime is missing")
    config = Path("/opt/knowtrail/integrations")
    config.mkdir(mode=0o700, parents=True, exist_ok=True)
    shutil.copy2(Path(__file__).with_name("runtime_adapter.py"), config / "runtime_adapter.py")
    app_env = config / "research-mcp.env"
    app_values = read_env(app_env) if app_env.exists() else {}
    token = app_values.setdefault("LINGBI_RESEARCH_MCP_SECRET", secrets.token_urlsafe(36))
    app_values["LINGBI_RESEARCH_MCP_ENABLED"] = "true"
    app_values["LINGBI_RESEARCH_MCP_EVIDENCE"] = str(config / "research-mcp-verification.json")
    write_env(app_env, app_values)
    giiisp = read_env(config / "giiisp.env") if (config / "giiisp.env").exists() else {}
    # Isolated PRISMA fork: GUI decisions are human decisions, not Claude calls.
    upstream_root = root / ".upstreams/external-prisma"
    prisma_source = config / "prisma-source"
    for name in ("prisma_review", "mcp_server", "api"):
        shutil.copytree(upstream_root / name, prisma_source / name, dirs_exist_ok=True,
                        ignore=shutil.ignore_patterns("__pycache__", "*.pyc", ".env", "config.yaml"))
    shutil.copy2(upstream_root / "LICENSE", prisma_source / "LICENSE")
    server_file = prisma_source / "mcp_server/server.py"
    text = server_file.read_text().replace('screen_method = "ai"', 'screen_method = "manual"').replace('eligibility_method = "ai"', 'eligibility_method = "manual"')
    server_file.write_text(text)
    diagram = prisma_source / "prisma_review/diagram.py"
    text = diagram.read_text().replace("keyword rules + AI review", "recorded screening decisions").replace("keyword rules + AI-assisted", "recorded screening decisions").replace("AI-assisted, stricter criteria", "recorded eligibility decisions")
    text = text.replace("- **AI-assisted screening**: Claude via Model Context Protocol (MCP)", "- **Further review**: Human decisions are recorded separately; any actual AI involvement must be declared from the decision log.")
    text = text.replace("PRISMA 2020 compliant", "PRISMA 2020 reporting structure; completeness requires researcher review")
    diagram.write_text(text)
    launcher = config / "prisma_stdio.py"
    launcher.write_text("import sys\nfrom pathlib import Path\nsys.path.insert(0, str(Path(__file__).parent / 'prisma-source'))\nfrom mcp_server import server\nserver.CONFIG_PATH = Path.cwd() / 'config.yaml'\nserver.mcp.run(transport='stdio')\n")
    # Runtime source is read-only to the service; state remains in StateDirectory.
    os.chmod(config, 0o755)
    for product, port in PRODUCTS.items():
        existing = read_env(Path(f"/etc/sci-onekey/{product}.env"))
        values = {key: value for key, value in existing.items() if key in TECHNICAL}
        values.update(SCI_MCP_PRODUCT_ID=product, PORT=str(port), ONEKEY_ENABLED="false",
                      ONEKEY_PRODUCT_CODE="", ONEKEY_LIVE_METERING="false",
                      MCP_AUTH_TOKEN=token, MCP_AUTH_HEADERS="x-sci-mcp-key",
                      SCI_MCP_WORKSPACE_ROOT=f"/var/lib/lingbi-research-{product}/workspaces",
                      SCI_MCP_METERING_DIR=f"/var/lib/lingbi-research-{product}/metering",
                      UPSTREAM_TIMEOUT_SECONDS="90", UPSTREAM_MAX_RETRIES="0")
        if product in {"paper-search", "papercheck"}:
            values.update(giiisp)
        if product == "external-prisma":
            values["UPSTREAM_ARGS_JSON"] = json.dumps([str(launcher)])
        write_env(config / f"{product}.env", values)
    unit = """[Unit]
Description=Private Lingbi research MCP %i
After=network-online.target
[Service]
Type=simple
DynamicUser=true
WorkingDirectory=/opt/sci-research-mcp
EnvironmentFile=/opt/knowtrail/integrations/%i.env
ExecStart=/opt/sci-research-mcp/.venv/bin/python /opt/knowtrail/integrations/runtime_adapter.py %i
StateDirectory=lingbi-research-%i
PrivateTmp=true
NoNewPrivileges=true
ProtectSystem=strict
ProtectHome=true
MemoryMax=768M
TasksMax=64
Restart=on-failure
RestartSec=5
[Install]
WantedBy=multi-user.target
"""
    Path("/etc/systemd/system/lingbi-research-mcp@.service").write_text(unit)
    dropin = Path("/etc/systemd/system/knowtrail.service.d")
    dropin.mkdir(exist_ok=True)
    (dropin / "research-mcp.conf").write_text("[Service]\nEnvironmentFile=/opt/knowtrail/integrations/research-mcp.env\n")
    subprocess.run(["systemctl", "daemon-reload"], check=True)
    for product in PRODUCTS:
        subprocess.run(["systemctl", "enable", "--now", f"lingbi-research-mcp@{product}"], check=True, capture_output=True)
    print("Private Lingbi MCP services prepared; existing marketplace services unchanged.")


if __name__ == "__main__":
    main()
