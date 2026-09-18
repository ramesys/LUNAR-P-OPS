import json
import sys
from pathlib import Path

from clps_api.main import app


def main() -> None:
    if len(sys.argv) != 2:
        sys.exit("usage: python -m clps_api.export_openapi <output.json>")
    output = Path(sys.argv[1])
    output.write_text(json.dumps(app.openapi(), indent=2) + "\n", encoding="utf-8")


if __name__ == "__main__":
    main()
