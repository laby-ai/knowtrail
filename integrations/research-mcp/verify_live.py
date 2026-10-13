"""Real protocol and behavior checks in a dedicated, non-customer workspace."""
import datetime
import json
import time
from pathlib import Path
import httpx
from dotenv import dotenv_values

PORTS = {"labmate": 9307, "pubcrawl": 9308, "prisma": 9309, "giiisp": 9301, "papercheck": 9310}


def unpack(result):
    structured = result.get("structuredContent")
    if isinstance(structured, dict):
        return structured
    texts = [item.get("text", "") for item in result.get("content", []) if item.get("type") == "text"]
    try:
        return json.loads("\n".join(texts))
    except ValueError:
        return {"text": "\n".join(texts)}


def main():
    token = dotenv_values("/opt/knowtrail/integrations/research-mcp.env")["LINGBI_RESEARCH_MCP_SECRET"]
    record = {"at": datetime.datetime.now(datetime.timezone.utc).isoformat(), "mode": "real", "products": {}}
    with httpx.Client(timeout=110, trust_env=False) as client:
        def call(name, tool, args, consumer="lingbi-integration-qa"):
            response = client.post(f"http://127.0.0.1:{PORTS[name]}/mcp", headers={
                "X-Sci-MCP-Key": token, "X-Mse-Consumer": consumer, "MCP-Protocol-Version": "2025-03-26"},
                json={"jsonrpc": "2.0", "id": 3, "method": "tools/call", "params": {"name": tool, "arguments": args}})
            response.raise_for_status()
            body = response.json()
            if body.get("error"):
                raise RuntimeError("protocol_error:" + str(body["error"].get("code")))
            result = body["result"]
            value = unpack(result)
            # Print only public scientific data and messages; no headers or credentials.
            safe = json.dumps(value, ensure_ascii=False).replace(token, "<redacted>")
            print(name, tool, "isError=" + str(result.get("isError", False)), safe[:1700], flush=True)
            return result, value

        for name, tool, args in [
            ("labmate", "calculate_molarity", {"moles": 0.01, "volume_ml": 100}),
            ("pubcrawl", "search_europepmc", {"query": "CRISPR genome editing", "max_results": 3}),
            ("giiisp", "search_papers", {"mode": "arxiv-id", "query": "1706.03762", "page_size": 1}),
            ("papercheck", "check_papercheck_env", {}),
        ]:
            try:
                result, value = call(name, tool, args)
                passed = not result.get("isError") and value.get("ok") is not False and not value.get("error") and not value.get("dry_run")
                record["products"][name] = {"verified": passed, "tool": tool, "at": record["at"]}
            except Exception as error:
                print(name, type(error).__name__, flush=True)
                record["products"][name] = {"verified": False, "tool": tool, "at": record["at"], "errorType": type(error).__name__}
        try:
            result, value = call("prisma", "get_project_config", {})
            if value.get("ok") is False:
                call("prisma", "configure_project", {"project_name": "Lingbi isolated integration verification", "query": "CRISPR genome editing", "date_start": "2012-01-01", "date_end": "2026-10-13", "include_keywords": "CRISPR", "max_results": 3})
            result, value = call("prisma", "get_project_config", {})
            _, isolated = call("prisma", "get_project_config", {}, consumer="lingbi-integration-qa-other")
            assert isolated.get("ok") is False, "workspace isolation failure"
            passed = not result.get("isError") and value.get("ok") is not False
            record["products"]["prisma"] = {"verified": passed, "tool": "configure_project/get_project_config", "isolationPassed": True, "at": record["at"]}
        except Exception as error:
            print("prisma", type(error).__name__, flush=True)
            record["products"]["prisma"] = {"verified": False, "at": record["at"], "errorType": type(error).__name__}
    output = Path("/opt/knowtrail/integrations/research-mcp-verification.json")
    output.write_text(json.dumps(record, ensure_ascii=False, indent=2))
    output.chmod(0o600)


if __name__ == "__main__":
    main()
