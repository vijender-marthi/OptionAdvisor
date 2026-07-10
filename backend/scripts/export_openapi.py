"""Export the FastAPI OpenAPI schema for frontend contract generation."""
from __future__ import annotations

import json
import os
import sys
import tempfile
from pathlib import Path


def main() -> int:
    repo_root = Path(__file__).resolve().parents[2]
    backend_dir = repo_root / "backend"
    output_path = repo_root / "frontend" / "src" / "api" / "generated" / "openapi.json"

    sys.path.insert(0, str(backend_dir))
    os.environ.setdefault("OPTION_ADVISOR_ALLOW_INSECURE_JWT", "1")
    os.environ.setdefault(
        "OPTION_ADVISOR_DB_PATH",
        str(Path(tempfile.gettempdir()) / "option_advisor_openapi_export.sqlite3"),
    )

    import main as app_main  # noqa: PLC0415

    schema = app_main.app.openapi()
    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(
        json.dumps(schema, sort_keys=True, indent=2, separators=(",", ": ")) + "\n",
        encoding="utf-8",
    )
    print(f"Wrote {output_path.relative_to(repo_root)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
