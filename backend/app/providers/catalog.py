import json
from pathlib import Path
from typing import Any

CATALOG: list[dict[str, Any]] = json.loads(
    Path(__file__).with_name("catalog.json").read_text(encoding="utf-8")
)
DIRECT = {entry["id"]: entry for entry in CATALOG if entry["integration"] == "direct"}
