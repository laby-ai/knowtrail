"""Versioned commercial policy. Amounts are integer CNY fen; asset is isolated."""
from datetime import datetime, timezone

ASSET = "lingbi.research-points.v1"
VERSION = "2026-10-13.v1"
PLANS = {
    "free": dict(name="免费版", monthly=0, annual=0, points=0, storage=1073741824, notebooks=3, seats=1, concurrent=1),
    "research": dict(name="科研版", monthly=3900, annual=39000, points=1000, storage=5368709120, notebooks=30, seats=1, concurrent=2),
    "pro": dict(name="专业版", monthly=7900, annual=79000, points=2500, storage=21474836480, notebooks=None, seats=1, concurrent=3),
    "team": dict(name="课题组版", monthly=29900, annual=299000, points=10000, storage=107374182400, notebooks=None, seats=5, concurrent=5),
}
FEES = {
    "chat": 2, "text-polishing": 2, "hypothesis-generation": 2, "experiment-design": 2,
    "academic-writing": 2, "peer-review": 2, "citation-verification": 2, "report": 2,
    "analyze": 2, "analyze-pdf": 2, "knowledge-map": 2, "knowledge-cards": 2,
    "discover-search": 3, "deep-research": 10, "scientific-illustration": 5,
    "ppt": 10, "ppt-html": 10, "ppt-v2": 10, "ppt-slide-revise": 5, "ppt-html-repair": 5,
}
UNPRICED = {"data-execute", "data-plan", "third-party-extraction", "podcast", "tts", "video"}
PREMIUM = {"scientific-illustration", "ppt", "deep-research"}


def utcnow():
    return datetime.now(timezone.utc)


def month_after(value, months=1):
    import calendar
    total = value.year * 12 + value.month - 1 + months
    year, month = divmod(total, 12)
    return value.replace(year=year, month=month + 1, day=min(value.day, calendar.monthrange(year, month + 1)[1]))


def catalog():
    return dict(asset=ASSET, version=VERSION, plans=PLANS, pointPacks=[dict(id=f"points.{yuan}", amountFen=yuan * 100, points=yuan * 100) for yuan in (20, 50, 100)],
                seat=dict(monthly=3900, annual=39000), serviceFees=FEES, unpriced=sorted(UNPRICED), currency="CNY", automaticRenewal=False)


def product(product_id):
    parts = str(product_id).split(".")
    if len(parts) == 2 and parts[0] == "points" and parts[1] in ("20", "50", "100"):
        return dict(kind="points", amount=int(parts[1]) * 100, points=int(parts[1]) * 100)
    if len(parts) == 2 and parts[0] in PLANS and parts[0] != "free" and parts[1] in ("monthly", "annual"):
        return dict(kind="subscription", amount=PLANS[parts[0]][parts[1]], plan=parts[0], months=1 if parts[1] == "monthly" else 12)
    if len(parts) == 2 and parts[0] == "seat" and parts[1] in ("monthly", "annual"):
        return dict(kind="seat", amount=3900 if parts[1] == "monthly" else 39000, months=1 if parts[1] == "monthly" else 12)
    raise ValueError("unknown_product")
