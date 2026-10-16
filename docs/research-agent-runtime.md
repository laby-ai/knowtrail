# Conversation research runtime

The NotebookLM-style sources / conversation / studio workbench uses AgentScope
2.0.10 for its conversation orchestration. Research Skill shortcuts stay beside
the shared composer; the studio's seven auxiliary tools remain in a separate
right pane. On phones, three tabs expose those same areas without squeezing them.
The Next endpoint `POST /api/agent/chat` first verifies the existing SMS account
and notebook scope. It reads only that owner's saved history and selected source
evidence. Each request starts a separate stdio worker; cancellation kills it and
aborts the host tool. No shared model memory, HTTP sidecar listener or browser
credential export is involved.

Install the pinned SDK in a dedicated Python 3.11+ environment with
`python -m pip install -r services/research-agent/requirements.txt`. Set
`KNOWTRAIL_AGENT_PYTHON` to its absolute Python executable. Preserve the existing
server-side model variables, account policy and data locations. Never install
the SDK into a system or another application's environment. Include the worker
and pinned requirements in the release and keep the previous release/runtime.

AgentScope's Toolkit mounts the eight existing research Skills as native Skill
objects; the default entry also accepts ordinary conversation. The only host
tools are an allowlisted academic search and an allowlisted plugin-window opener.
Search calls the existing official arXiv provider module and returns real
candidate metadata. Other windows reuse the existing forms and saved artifacts;
opening one does not mean generation has happened. There is no arbitrary shell,
filesystem, MCP installation, URL execution or model-generated UI evaluation.

Tool calls and results are stored with the existing private, versioned chat
document. The browser renders typed cards, can inspect/ingest search candidates
through the existing upload pipeline, and opens plugin workspaces inside the
conversation. Follow-up turns reconstruct context from that owner's server-side
history. The legacy API and right-hand tools remain compatible; direct generators
still use their existing ownership checks, persistence and model routing.

Limits: at most seven reasoning iterations and four host calls per turn, no
automatic provider retry, 180-second cancellation deadline. Final content uses
the existing Max configuration; auxiliary extraction continues to use Flash.
Private responses are `private, no-store`. A missing or broken runtime fails
explicitly instead of silently pretending that another engine executed the task.

Compatibility and quality tests default to `qwen3.8-flash`, with small inputs,
bounded output and no automatic paid retries. Use deterministic fixtures for
regression coverage. Max tests require a concrete quality or compatibility gap;
changing the test model does not silently change production generation routing.
