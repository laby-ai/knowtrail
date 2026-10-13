"""Test private PDF/text conversion using synthetic, non-customer evidence."""
import base64
import json
import httpx
import pymupdf
from dotenv import dotenv_values
from verify_live import unpack

token = dotenv_values('/opt/knowtrail/integrations/research-mcp.env')['LINGBI_RESEARCH_MCP_SECRET']
headers = {'X-Sci-MCP-Key': token, 'X-Mse-Consumer': 'lingbi-conversion-qa', 'MCP-Protocol-Version': '2025-03-26'}
with httpx.Client(timeout=110, trust_env=False) as client:
    def call(tool, args):
        response = client.post('http://127.0.0.1:9310/mcp', headers=headers, json={'jsonrpc': '2.0', 'id': 1, 'method': 'tools/call', 'params': {'name': tool, 'arguments': args}})
        response.raise_for_status()
        result = response.json()['result']
        return result, unpack(result)

    text = 'The Transformer uses attention mechanisms [1].\nReferences\n[1] Vaswani A, et al. Attention Is All You Need. 2017.'
    pdf = pymupdf.open()
    page = pdf.new_page()
    page.insert_text((72, 72), text)
    blank = pymupdf.open()
    blank.new_page()
    for name, data, expected in [('evidence.pdf', pdf.tobytes(), 'pdf-text-layer'), ('evidence.txt', text.encode(), 'utf-8-text')]:
        result, _ = call('upload_workspace_file', {'path': 'inputs/' + name, 'content_base64': base64.b64encode(data).decode()})
        assert result.get('isError') is not True
        result, value = call('extract_citation_evidence', {'workspace_file': 'inputs/' + name})
        assert result.get('isError') is not True, 'conversion failed'
        assert value.get('source_format') == expected
        assert value.get('returncode', 0) == 0
        result, evidence = call('read_workspace_file', {'path': 'citation_evidence.json'})
        assert result.get('isError') is not True
        # Verify actual extracted evidence, not just a successful process exit.
        assert 'Vaswani' in json.dumps(evidence)
        print('PASS', name, 'real evidence and provenance')
    call('upload_workspace_file', {'path': 'inputs/blank.pdf', 'content_base64': base64.b64encode(blank.tobytes()).decode()})
    result, value = call('extract_citation_evidence', {'workspace_file': 'inputs/blank.pdf'})
    assert result.get('isError') is True or value.get('ok') is False or value.get('error')
    assert 'OCR' in json.dumps(value, ensure_ascii=False)
    print('PASS blank PDF rejected with OCR guidance')
