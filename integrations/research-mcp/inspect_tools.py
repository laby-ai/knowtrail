"""Read-only protocol discovery. Never output credentials or customer state."""
import json
from pathlib import Path
import httpx
from dotenv import dotenv_values

PORTS = {"labmate": 9307, "pubcrawl": 9308, "prisma": 9309, "giiisp": 9301, "papercheck": 9310}


def main():
    token = dotenv_values("/opt/knowtrail/integrations/research-mcp.env")["LINGBI_RESEARCH_MCP_SECRET"]
    output = {}
    with httpx.Client(timeout=100, trust_env=False) as client:
        for name, port in PORTS.items():
            headers = {"X-Sci-MCP-Key": token, "X-Mse-Consumer": "lingbi-integration-qa",
                       "MCP-Protocol-Version": "2025-03-26"}
            url = f"http://127.0.0.1:{port}/mcp"
            initialized = client.post(url, headers=headers, json={"jsonrpc": "2.0", "id": 1, "method": "initialize",
                "params": {"protocolVersion": "2025-03-26", "capabilities": {}, "clientInfo": {"name": "lingbi-verification", "version": "1"}}})
            initialized.raise_for_status()
            listed = client.post(url, headers=headers, json={"jsonrpc": "2.0", "id": 2, "method": "tools/list", "params": {}})
            listed.raise_for_status()
            tools = listed.json()["result"]["tools"]
            output[name] = tools
            print(name, "initialize/list PASS", len(tools), "tools:", ", ".join(tool["name"] for tool in tools))
    target = Path("/opt/knowtrail/integrations/research-mcp-tools.json")
    target.write_text(json.dumps(output, ensure_ascii=False, indent=2))
    target.chmod(0o600)


if __name__ == "__main__":
    main()
