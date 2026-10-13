"""Read-only readiness report. No member identifiers, secrets or prompts exported."""
import json
from db import connect
from lingbi_orders import readiness

with connect() as conn:
    rows = conn.execute("SELECT created_at,data_json FROM lingbi_usage ORDER BY created_at").fetchall()
summary = {}
for row in rows:
    value = json.loads(row["data_json"])
    key = value.get("operation", "unknown")
    item = summary.setdefault(key, dict(tasks=0, unverified=0, resourceKeys=set()))
    item["tasks"] += 1
    if not value.get("reliable") or value.get("modelPoints") is None:
        item["unverified"] += 1
    for resource in value.get("resources", []):
        item["resourceKeys"].add(resource.get("rateKey", "unknown"))
for item in summary.values(): item["resourceKeys"] = sorted(item["resourceKeys"])
print(json.dumps(dict(readiness=readiness(), recordedFrom=rows[0]["created_at"] if rows else None, tasks=len(rows), operations=summary), ensure_ascii=False, indent=2))
