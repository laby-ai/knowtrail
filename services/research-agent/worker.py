"""One AgentScope session per request. Only allowlisted host tools, over stdio.

The host retains SMS credentials, notebook ownership, storage and tool execution.
No shell, file-system, MCP discovery or arbitrary UI/code tools are exposed.
"""
import asyncio
import json
import sys
from uuid import uuid4

from agentscope.agent import Agent, ReActConfig
from agentscope.credential import OpenAICredential
from agentscope.message import AssistantMsg, Msg, TextBlock, ToolResultState, UserMsg
from agentscope.model import OpenAIChatModel
from agentscope.permission import PermissionBehavior, PermissionDecision
from agentscope.skill import Skill
from agentscope.state import AgentState
from agentscope.tool import FunctionTool, Toolkit, ToolChunk


def emit(event):
    print(json.dumps(event, ensure_ascii=False), flush=True)


async def main():
    bootstrap = json.loads(sys.stdin.readline())
    calls = 0

    async def invoke(name, arguments):
        nonlocal calls
        calls += 1
        if calls > 4:
            return ToolChunk(content=[TextBlock(text="本轮工具调用次数已到上限。请依据已有结果回答，不再调用工具。")], state=ToolResultState.ERROR)
        call_id = str(uuid4())
        emit({"type": "invoke", "id": call_id, "name": name, "arguments": arguments})
        line = await asyncio.to_thread(sys.stdin.readline)
        if not line:
            raise asyncio.CancelledError()
        result = json.loads(line)
        if result.get("id") != call_id:
            raise ValueError("Tool response does not match the pending call")
        return ToolChunk(content=[TextBlock(text=json.dumps(result["result"], ensure_ascii=False))], state=ToolResultState.SUCCESS if result["result"].get("success") else ToolResultState.ERROR)

    async def search_papers(query: str):
        """Search academic papers. Returns real candidates, not verified scientific conclusions."""
        return await invoke("search_papers", {"query": query})

    async def open_plugin(plugin: str, request: str):
        """Open a research plugin in this conversation. Use the allowed plugin IDs in the system instructions."""
        return await invoke("open_plugin", {"plugin": plugin, "request": request})

    async def prepare_presentation(outline: list[dict[str, str]]):
        """Prepare a source-grounded editable PPT outline for user confirmation. Does not generate a file."""
        return await invoke("prepare_presentation", {"outline": outline})

    async def generate_report(question: str):
        """Generate and privately save a report from this turn's selected evidence. Only on explicit user request."""
        return await invoke("generate_report", {"question": question})

    async def generate_research_design(kind: str, question: str, experiment: dict | None = None):
        """Generate and privately save hypotheses or a pre-collection protocol, using explicit user design choices."""
        arguments = {"kind": kind, "question": question}
        if experiment is not None:
            arguments["experiment"] = experiment
        return await invoke("generate_research_design", arguments)

    async def generate_knowledge_map(question: str, deepExtract: bool):
        """Generate and privately save a source-grounded map. Deep extraction only on explicit user request."""
        return await invoke("generate_knowledge_map", {"question": question, "deepExtract": deepExtract})

    async def generate_data_plan(sourceId: str, question: str, sampleUnit: str, taskFamily: str, targetColumn: str | None = None, splitColumn: str | None = None):
        """Diagnose a selected CSV/XLSX and privately save a plan. Does not run statistical tests or training."""
        arguments = {"sourceId": sourceId, "question": question, "sampleUnit": sampleUnit, "taskFamily": taskFamily}
        if targetColumn is not None:
            arguments["targetColumn"] = targetColumn
        if splitColumn is not None:
            arguments["splitColumn"] = splitColumn
        return await invoke("generate_data_plan", arguments)

    async def generate_learning_materials(kind: str, question: str):
        """Generate source-grounded study cards or card-based review and privately save this turn's version."""
        return await invoke("generate_learning_materials", {"kind": kind, "question": question})

    async def generate_illustration(purpose: str, figureKind: str, aspectRatio: str, requiredLabels: list[str]):
        """Generate one selected-source schematic and privately save this turn's image. Always requires human review."""
        return await invoke("generate_illustration", {"purpose": purpose, "figureKind": figureKind, "aspectRatio": aspectRatio, "requiredLabels": requiredLabels})

    tools = [
        FunctionTool(generate_illustration, is_read_only=False, is_concurrency_safe=False,
                     permission=PermissionDecision(behavior=PermissionBehavior.ALLOW, message="The host verifies selected sources, ownership, one image attempt and private version saving."),
                     input_schema={"type":"object","properties":{"purpose":{"type":"string","minLength":8,"maxLength":1200},"figureKind":{"type":"string","enum":["workflow","conceptual-framework","method-diagram","mechanism-schematic"]},"aspectRatio":{"type":"string","enum":["1:1","4:3","16:9"]},"requiredLabels":{"type":"array","maxItems":6,"items":{"type":"string","minLength":1,"maxLength":40}}},"required":["purpose","figureKind","aspectRatio","requiredLabels"],"additionalProperties":False}),
        FunctionTool(generate_learning_materials, is_read_only=False, is_concurrency_safe=False,
                     permission=PermissionDecision(behavior=PermissionBehavior.ALLOW, message="The host verifies selected sources, ownership, one attempt and private version saving."),
                     input_schema={"type":"object","properties":{"kind":{"type":"string","enum":["knowledge-cards","quiz"]},"question":{"type":"string","minLength":1,"maxLength":1200}},"required":["kind","question"],"additionalProperties":False}),
        FunctionTool(generate_data_plan, is_read_only=False, is_concurrency_safe=False,
                     permission=PermissionDecision(behavior=PermissionBehavior.ALLOW, message="The host verifies the selected table, explicit task, one attempt and private versioned save."),
                     input_schema={"type":"object","properties":{"sourceId":{"type":"string","minLength":1,"maxLength":180},"question":{"type":"string","minLength":1,"maxLength":1200},"sampleUnit":{"type":"string","minLength":1,"maxLength":200},"taskFamily":{"type":"string","enum":["description","prediction","comparison","trend"]},"targetColumn":{"type":"string","maxLength":200},"splitColumn":{"type":"string","maxLength":200}},"required":["sourceId","question","sampleUnit","taskFamily"],"additionalProperties":False}),
        FunctionTool(generate_knowledge_map, is_read_only=False, is_concurrency_safe=False,
                     permission=PermissionDecision(behavior=PermissionBehavior.ALLOW, message="The host verifies selected evidence, ownership, one attempt and versioned saving."),
                     input_schema={"type":"object","properties":{"question":{"type":"string","minLength":1,"maxLength":1200},"deepExtract":{"type":"boolean"}},"required":["question","deepExtract"],"additionalProperties":False}),
        FunctionTool(search_papers, is_read_only=True, is_concurrency_safe=False),
        FunctionTool(open_plugin, is_read_only=True, is_concurrency_safe=False,
                     input_schema={"type":"object","properties":{"plugin":{"type":"string","enum":bootstrap["plugins"]},"request":{"type":"string","maxLength":4000}},"required":["plugin","request"]}),
        FunctionTool(prepare_presentation, is_read_only=True, is_concurrency_safe=False,
                     input_schema={"type":"object","properties":{"outline":{"type":"array","minItems":1,"maxItems":18,"items":{"type":"object","properties":{"title":{"type":"string","minLength":1,"maxLength":80},"focus":{"type":"string","minLength":1,"maxLength":220}},"required":["title","focus"],"additionalProperties":False}}},"required":["outline"],"additionalProperties":False}),
        FunctionTool(generate_report, is_read_only=False, is_concurrency_safe=False,
                     permission=PermissionDecision(behavior=PermissionBehavior.ALLOW, message="The host verifies ownership, one attempt and versioned saving for this report tool."),
                     input_schema={"type":"object","properties":{"question":{"type":"string","minLength":1,"maxLength":1200}},"required":["question"],"additionalProperties":False}),
        FunctionTool(generate_research_design, is_read_only=False, is_concurrency_safe=False,
                     permission=PermissionDecision(behavior=PermissionBehavior.ALLOW, message="The host verifies ownership, explicit inputs, one attempt and durable versioned saving."),
                     input_schema={"type":"object","properties":{"kind":{"type":"string","enum":["hypothesis-generation","experiment-design"]},"question":{"type":"string","minLength":1,"maxLength":1200},"experiment":{"type":"object","properties":{"hypothesis":{"type":"string","minLength":1,"maxLength":1200},"experimentalUnit":{"type":"string","minLength":1,"maxLength":1200},"arms":{"type":"array","minItems":2,"maxItems":8,"items":{"type":"string","minLength":1,"maxLength":1200}},"primaryOutcome":{"type":"string","minLength":1,"maxLength":1200},"constraints":{"type":"string","maxLength":1200},"alpha":{"type":"number","exclusiveMinimum":0,"exclusiveMaximum":1},"targetPower":{"type":"number","exclusiveMinimum":0,"exclusiveMaximum":1}},"required":["hypothesis","experimentalUnit","arms","primaryOutcome","constraints","alpha","targetPower"],"additionalProperties":False}},"required":["kind","question"],"additionalProperties":False}),
    ]
    skills = [Skill(name=s["id"], description=s["description"], dir="/research-skills/"+s["id"],
                    markdown=s["instructions"], updated_at=0) for s in bootstrap["skills"]
              if not bootstrap.get("inlineSkill") or s["id"] == bootstrap["inlineSkill"]]
    if bootstrap.get("inlineSkill"):
        tools = []
    config = bootstrap["model"]
    model = OpenAIChatModel(
        credential=OpenAICredential(api_key=config["apiKey"], base_url=config["apiBase"]),
        model=config["name"], max_retries=0,
        parameters=OpenAIChatModel.Parameters(max_tokens=config["maxTokens"], temperature=0.3, parallel_tool_calls=False),
        client_kwargs={"timeout": 65.0, "max_retries": 0},
        extra_body={"enable_thinking": False},
    )
    history = []
    for message in bootstrap["history"]:
        factory = UserMsg if message["role"] == "user" else AssistantMsg
        history.append(factory(name=message["role"], content=message["content"]))
    agent = Agent(name="KnowTrail", system_prompt=bootstrap["systemPrompt"], model=model,
                  toolkit=Toolkit(tools=tools, skills_or_loaders=skills),
                  state=AgentState(session_id=bootstrap["sessionId"], context=history),
                  react_config=ReActConfig(max_iters=7))
    emit({"type": "ready", "engine": "agentscope", "version": "2.0.10"})
    # Tool-bearing intermediate text is not the final writing body.
    inline = bool(bootstrap.get("inlineSkill"))
    async for event in agent.reply_stream(UserMsg(name="user", content=bootstrap["message"]), yield_final_msg=inline):
        kind = type(event).__name__
        if inline and isinstance(event, Msg):
            final_text = event.get_text_content()
            if event.role == "assistant" and final_text:
                emit({"type": "text", "delta": final_text})
        elif kind == "TextBlockDeltaEvent" and not inline:
            emit({"type": "text", "delta": event.delta})
        elif kind == "ModelCallEndEvent":
            emit({"type": "usage", "inputTokens": event.input_tokens, "outputTokens": event.output_tokens})
        elif kind == "ReplyEndEvent":
            reason = str(event.finished_reason)
            emit({"type": "end", "reason": reason, "error": "本轮未完成，请重试。" if event.error else None})


if __name__ == "__main__":
    try:
        asyncio.run(main())
    except (KeyboardInterrupt, asyncio.CancelledError):
        pass
    except Exception:
        # Never send provider exceptions, secrets, prompts or Python traces to stdout.
        emit({"type": "error", "error": "研究助手暂时无法完成请求，请重试。"})
        sys.exit(1)
