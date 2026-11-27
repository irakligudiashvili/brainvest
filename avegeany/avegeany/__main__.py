import os
import sys
from pathlib import Path


def _ensure_venv():
    """`python -m avegeany` started by a Python without the dependencies (e.g. the
    system Python because the venv wasn't activated): restart under the project's
    .venv instead of failing later, in the middle of processing a scan."""
    try:
        import numpy  # noqa: F401
        import scipy  # noqa: F401
        import trimesh  # noqa: F401
        return
    except ImportError as e:
        missing = e.name
    venv = Path(__file__).resolve().parent.parent / ".venv"
    venv_py = venv / "bin" / "python"
    # (the venv's python is a symlink to the same binary: compare environments, not paths)
    if venv_py.exists() and Path(sys.prefix).resolve() != venv.resolve() \
            and not os.environ.get("AVEGEANY_REEXEC"):
        print(f"[avegeany] {missing} is missing in {sys.executable}; using {venv_py}", file=sys.stderr)
        os.environ["AVEGEANY_REEXEC"] = "1"
        os.execv(str(venv_py), [str(venv_py), "-m", "avegeany", *sys.argv[1:]])
    sys.exit(f"avegeany needs {missing}: run  source .venv/bin/activate.fish  then  "
             "pip install -r requirements.txt")


_ensure_venv()

from .cli import main  # noqa: E402

main()
