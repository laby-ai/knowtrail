"""Serialize upload/notebook capacity leases in the account DB."""
from datetime import timedelta
from lingbi_catalog import PLANS, utcnow
from lingbi_store import active_plan, locked, uid
from lingbi_orders import readiness


def capacity(tenant, member, account, data):
    with locked(account, tenant, member) as (_, state):
        metrics = state.setdefault("capacity", {})
        leases = state.setdefault("capacityLeases", [])
        leases[:] = [item for item in leases if item["expires"] > utcnow().isoformat()]
        action = data.get("action")
        if action == "release":
            leases[:] = [item for item in leases if item["id"] != data.get("leaseId") or item["member"] != member]
            return dict(status="released")
        fields = ("usedBytes", "usedNotebooks", "addBytes", "addNotebooks")
        if any(type(data.get(key)) != int or not 0 <= data[key] <= 1000000000000 for key in fields):
            raise ValueError("invalid_capacity_inventory")
        metrics[member] = dict(bytes=data["usedBytes"], notebooks=data["usedNotebooks"])
        total_bytes = sum(item["bytes"] for item in metrics.values()) + sum(item["bytes"] for item in leases) + data["addBytes"]
        total_books = sum(item["notebooks"] for item in metrics.values()) + sum(item["notebooks"] for item in leases) + data["addNotebooks"]
        limits = PLANS[active_plan(state)]
        if readiness()["chargingReady"]:
            if data["addBytes"] and total_bytes > limits["storage"]:
                raise ValueError("storage_capacity_exceeded")
            if data["addNotebooks"] and limits["notebooks"] is not None and total_books > limits["notebooks"]:
                raise ValueError("notebook_limit_exceeded")
        lease_id = uid("capacity")
        leases.append(dict(id=lease_id, member=member, bytes=data["addBytes"], notebooks=data["addNotebooks"], expires=(utcnow() + timedelta(minutes=30)).isoformat()))
    return dict(leaseId=lease_id)
