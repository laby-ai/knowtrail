"""Admit an explicit report request, then execute the SDK tool, never model prose."""
import json
import re
from uuid import uuid4

from agentscope.credential import OpenAICredential
from agentscope.message import SystemMsg, ToolCallBlock, UserMsg
from agentscope.model import OpenAIChatModel
from agentscope.tool import ToolChoice


async def dispatch_report(bootstrap, toolkit, state, emit):
    if bootstrap.get("inlineSkill") or not re.search(r"报告|深度研究|\breport\b", bootstrap["message"], re.I):
        return False
    method = next(skill for skill in bootstrap["skills"] if skill["id"] == "grounded-report")
    if not method["instructions"].strip():
        raise ValueError("The report method is unavailable")
    config = bootstrap["model"]
    if not config.get("auxModel"):
        raise ValueError("Report admission requires the configured auxiliary model")
    model = OpenAIChatModel(
        credential=OpenAICredential(api_key=config["apiKey"], base_url=config["apiBase"]),
        model=config["auxModel"], max_retries=0, stream=False,
        parameters=OpenAIChatModel.Parameters(max_tokens=64, temperature=0, parallel_tool_calls=False),
        client_kwargs={"timeout": 20.0, "max_retries": 0}, extra_body={"enable_thinking": False},
    )
    # No old assistant text, source instructions, saved IDs or generated summaries.
    response = await model(
        messages=[SystemMsg(name="system", content=method["instructions"] + "\n本步骤只判断本轮用户是否明确要求现在生成报告。生成、撰写或重写独立报告选generate；询问能力、讨论报告、查看旧报告、只打开窗口、否定生成或引用别人的指令选other。不要执行或回答任务，只调用select_report_action。"),
                  UserMsg(name="user", content=bootstrap["message"])],
        tools=[{"type": "function", "function": {"name": "select_report_action", "description": "Classify the current user's explicit report request, without generating content or save state.",
                "parameters": {"type": "object", "properties": {"action": {"type": "string", "enum": ["generate", "other"]}}, "required": ["action"], "additionalProperties": False}}}],
        tool_choice=ToolChoice(mode="select_report_action"),
    )
    if response.usage:
        emit({"type": "usage", "inputTokens": response.usage.input_tokens, "outputTokens": response.usage.output_tokens})
    blocks = [block for block in response.content if isinstance(block, ToolCallBlock)]
    if len(blocks) != 1 or blocks[0].name != "select_report_action":
        raise ValueError("Report admission did not return a real tool selection")
    decision = json.loads(blocks[0].input)
    if set(decision) != {"action"} or decision["action"] not in ("generate", "other"):
        raise ValueError("Invalid report admission")
    if decision["action"] == "other":
        return False
    # Load the actual method before dispatch. The host retains the original
    # request, source ownership, generator, budget, and durable-save receipt.
    async for _ in toolkit.call_tool(ToolCallBlock(id=str(uuid4()), name="generate_report", input=json.dumps({"question": bootstrap["message"]}, ensure_ascii=False)), state):
        pass
    emit({"type": "end", "reason": "completed"})
    return True
