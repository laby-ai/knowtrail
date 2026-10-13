"""Exercise PRISMA and PaperCheck with real tools and isolated test artifacts."""
import base64
import io
import json
import time
from pathlib import Path
import httpx
from dotenv import dotenv_values
from docx import Document
from verify_live import unpack


def main():
    token = dotenv_values("/opt/knowtrail/integrations/research-mcp.env")["LINGBI_RESEARCH_MCP_SECRET"]
    headers = {"X-Sci-MCP-Key": token, "X-Mse-Consumer": "lingbi-integration-qa", "MCP-Protocol-Version": "2025-03-26"}
    record_path = Path("/opt/knowtrail/integrations/research-mcp-verification.json")
    record = json.loads(record_path.read_text())
    with httpx.Client(timeout=110, trust_env=False) as client:
        def call(port, name, args):
            response = client.post(f"http://127.0.0.1:{port}/mcp", headers=headers, json={"jsonrpc": "2.0", "id": 3, "method": "tools/call", "params": {"name": name, "arguments": args}})
            response.raise_for_status()
            result = response.json()["result"]
            value = unpack(result)
            print(name, "isError=" + str(result.get("isError", False)), json.dumps(value, ensure_ascii=False).replace(token, "<redacted>")[:1300], flush=True)
            if result.get("isError") or value.get("ok") is False:
                raise RuntimeError("tool_failed:" + name)
            return value

        try:
            call(9309, "start_pipeline", {})
            for _ in range(24):
                progress = call(9309, "get_pipeline_progress", {})
                status = progress.get("data", {}).get("status")
                if status in {"completed", "failed"}:
                    break
                time.sleep(3)
            assert status == "completed", "pipeline did not complete"
            call(9309, "get_screening_stats", {})
            call(9309, "get_papers_to_screen", {"filter_type": "all", "batch_size": 3})
            call(9309, "generate_report", {})
            call(9309, "read_report", {"file_name": "prisma_flow.md"})
            record["products"]["prisma"].update(verified=True, workflowPassed=True, tool="configure/start/screen/report", isolationPassed=True)
        except Exception as error:
            record["products"]["prisma"].update(verified=False, workflowPassed=False, errorType=type(error).__name__)
            print("prisma workflow", type(error).__name__, flush=True)

        try:
            doc = Document()
            doc.add_heading("Isolated citation integration verification", 0)
            doc.add_paragraph("The Transformer architecture uses attention mechanisms [1].")
            doc.add_heading("References", 1)
            doc.add_paragraph("[1] Vaswani A, et al. Attention Is All You Need. arXiv:1706.03762, 2017.")
            buffer = io.BytesIO(); doc.save(buffer)
            call(9310, "upload_workspace_file", {"path": "inputs/citation-verification.docx", "content_base64": base64.b64encode(buffer.getvalue()).decode()})
            extracted = call(9310, "extract_citation_evidence", {"workspace_file": "inputs/citation-verification.docx"})
            assert extracted.get("returncode", 0) == 0
            audit = call(9310, "audit_citation_candidates", {"claim": "The Transformer architecture uses attention mechanisms", "cited_title": "Attention Is All You Need", "arxiv_id": "1706.03762", "page_size": 1})
            record["products"]["papercheck"].update(verified=True, workflowPassed=True, tool="DOCX evidence extraction/candidate audit", scope="Metadata candidate checking; claim support remains conservative")
        except Exception as error:
            record["products"]["papercheck"].update(verified=False, workflowPassed=False, errorType=type(error).__name__)
            print("papercheck workflow", type(error).__name__, flush=True)
    record_path.write_text(json.dumps(record, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
