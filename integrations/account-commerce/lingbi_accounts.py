import json
from db import connect
from lingbi_catalog import ASSET, PLANS, utcnow
from lingbi_store import active_plan, balance, decode, ensure_personal, locked, new_state, uid, event


def summary(tenant, member, account=None):
    personal = ensure_personal(tenant, member)
    selected = account or personal
    with locked(selected, tenant, member) as (conn, state):
        role = state["members"][member]
        plan = active_plan(state)
        account_balance = balance(state)
        budget_remaining = None
        if role != "admin":
            own_tasks = conn.execute("SELECT status,data_json FROM lingbi_tasks WHERE account_id=? AND member_id=? AND created_at>=?", (selected, member, utcnow().isoformat()[:7])).fetchall()
            used = sum(json.loads(item["data_json"])["maxPoints"] if item["status"] in ("reserved", "reconcile") else json.loads(item["data_json"])["settledPoints"] for item in own_tasks)
            budget_remaining = max(0, state["budgets"][member] - used) if member in state["budgets"] else None
            account_balance = dict(gifted=0, purchased=0, reserved=sum(json.loads(item["data_json"])["maxPoints"] for item in own_tasks if item["status"] in ("reserved", "reconcile")))
        params = (selected,) if role == "admin" else (selected, member)
        own_filter = "" if role == "admin" else " AND member_id=?"
        def rows(table):
            return [dict(id=row["id"], createdAt=row["created_at"], **({"status": row["status"], "amountFen": row["amount_fen"]} if table == "lingbi_orders" else {}), **json.loads(row["data_json"])) for row in conn.execute(f"SELECT * FROM {table} WHERE account_id=?{own_filter} ORDER BY created_at DESC LIMIT 50", params).fetchall()]
        return dict(asset=ASSET, accountId=selected, kind=state["kind"], role=role, plan=plan, planName=PLANS[plan]["name"], endsAt=state["end"],
                    accountName=state.get("name", "个人账户"), memberDetails=[dict(id=row["id"], email=row["email"], displayName=row["display_name"], role=state["members"][row["id"]]) for row in conn.execute("SELECT id,email,display_name FROM tenant_members WHERE tenant_id=?", (tenant,)).fetchall() if row["id"] in state["members"]] if role == "admin" else [],
                    balance=account_balance, verified=state["verified"], modelSource=decode(conn.execute("SELECT state_json FROM lingbi_accounts WHERE id=?", (personal,)).fetchone())["modelSource"], budget=state["budgets"].get(member), budgetRemaining=budget_remaining,
                    members=state["members"] if role == "admin" else None, budgets=state["budgets"] if role == "admin" else None,
                    limits=PLANS[plan], events=rows("lingbi_events"), orders=rows("lingbi_orders"), usage=rows("lingbi_usage"))


def list_accounts(tenant, member):
    ensure_personal(tenant, member)
    with connect() as conn:
        return [dict(id=row["id"], name=decode(row).get("name", "个人账户"), kind=row["kind"], role=decode(row)["members"][member], plan=active_plan(decode(row))) for row in conn.execute("SELECT * FROM lingbi_accounts WHERE tenant_id=?", (tenant,)).fetchall() if member in decode(row)["members"]]


def create_team(tenant, member, name):
    if not isinstance(name, str) or not 1 <= len(name.strip()) <= 80:
        raise ValueError("invalid_team_name")
    with connect() as conn:
        count = conn.execute("SELECT COUNT(*) AS count FROM lingbi_accounts WHERE tenant_id=? AND owner_id=? AND kind='team'", (tenant, member)).fetchone()["count"]
        if count >= 3:
            raise ValueError("team_creation_limit")
        account = uid("team")
        state = new_state(member, "team")
        state["name"] = name.strip()
        conn.execute("INSERT INTO lingbi_accounts(id,tenant_id,owner_id,kind,state_json) VALUES(?,?,?,?,?)", (account, tenant, member, "team", json.dumps(state)))
    return dict(accountId=account)


def update_team(tenant, member, account, data):
    with locked(account, tenant, member, admin=True) as (conn, state):
        if state["kind"] != "team":
            raise ValueError("not_team_account")
        target = conn.execute("SELECT id,status FROM tenant_members WHERE tenant_id=? AND lower(email)=?", (tenant, str(data.get("email", "")).strip().lower())).fetchone()
        if not target or target["status"] != "active":
            raise ValueError("active_member_in_same_organization_required")
        target_id = target["id"]
        action = data.get("action")
        if action == "remove":
            if target_id == state["owner"]:
                raise ValueError("owner_cannot_be_removed")
            state["members"].pop(target_id, None)
            state["budgets"].pop(target_id, None)
        elif action == "budget":
            limit = data.get("points")
            if target_id not in state["members"] or type(limit) != int or not 0 <= limit <= 10000000:
                raise ValueError("invalid_member_budget")
            state["budgets"][target_id] = limit
        elif action == "add":
            seats = PLANS[active_plan(state)]["seats"] + sum(1 for item in state["seats"] if item["end"] > utcnow().isoformat())
            if target_id not in state["members"] and len(state["members"]) >= seats:
                raise ValueError("seat_limit_reached")
            state["members"][target_id] = "member"
        else:
            raise ValueError("invalid_team_action")
        event(conn, account, member, uid("team-event"), dict(type="team_members", action=action, memberId=target_id))
    return dict(status="ok")


def preference(tenant, member, source):
    if source not in ("platform", "byok"):
        raise ValueError("invalid_model_source")
    with locked(ensure_personal(tenant, member), tenant, member) as (_, state):
        state["modelSource"] = source
    return dict(status="ok", modelSource=source)
