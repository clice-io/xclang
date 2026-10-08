"""Build the documented Xmake example with a released xclang installation."""
import argparse
import logging
import logging.handlers
import os
import platform
import queue
import shutil
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
LOGS = Path(__file__).resolve().parent / "logs"
TARGETS = (("mingw", "x86_64", "COFF-x86-64", "x86_64"),
           ("mingw", "arm64", "COFF-ARM64", "aarch64"),
           ("linux", "x86_64", "elf64-x86-64", "x86_64"),
           ("linux", "arm64", "elf64-littleaarch64", "aarch64"))


def run(args, cwd, env):
    print("+ " + subprocess.list2cmdline([str(arg) for arg in args]), flush=True)
    result = subprocess.run(args, cwd=cwd, env=env, stdin=subprocess.DEVNULL,
                            stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
                            text=True, encoding="utf-8", errors="replace")
    logging.info("%s\n%s", args, result.stdout)
    if result.returncode:
        raise RuntimeError(f"Command exited with {result.returncode}: {result.stdout}")
    return result.stdout


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--tree", type=Path, help="Root of the unpacked xclang distribution")
    parser.add_argument("--toolchain", choices=("llvm", "xclang"), default="llvm",
                        help="Xmake toolchain; xclang requires the proposed upstream integration")
    args = parser.parse_args()
    tree = args.tree
    if tree is None:
        manager = shutil.which("xclang")
        if manager is None:
            parser.error("Pass --tree or put the distribution's bin directory on PATH")
        tree = Path(manager).resolve().parent.parent
    tree = tree.resolve()
    suffix = ".exe" if sys.platform == "win32" else ""
    readobj = tree / "bin" / ("llvm-readobj" + suffix)
    xmake = shutil.which("xmake")
    if xmake is None or not readobj.is_file():
        parser.error("Xmake on PATH and llvm-readobj in the specified tree are required")
    project = ROOT / "examples" / "quickstart"
    env = os.environ.copy()
    env["XMAKE_COLORTERM"] = "nocolor"
    env["PATH"] = str(tree / "bin") + os.pathsep + env.get("PATH", "")
    print(run([xmake, "--version"], project, env))
    print(run([tree / "bin" / ("clang" + suffix), "--version"], project, env))
    expected = (project / "expected.txt").read_text(encoding="utf-8").strip()
    targets = list(TARGETS)
    if sys.platform == "darwin":
        targets.extend((("macosx", "x86_64", "Mach-O 64-bit x86-64", "x86_64"),
                        ("macosx", "arm64", "Mach-O arm64", "aarch64")))
    machine = platform.machine().lower()
    native_arch = "arm64" if machine in ("aarch64", "arm64") else "x86_64"
    native_plat = {"win32": "mingw", "darwin": "macosx"}.get(sys.platform, "linux")
    for plat, arch, fmt, object_arch in targets:
        run([xmake, "f", "-P", project, "-c", "-y", "-p", plat, "-a", arch,
             "--toolchain=" + args.toolchain, "--sdk=" + str(tree),
             "--builddir=build-xmake"], project, env)
        print(run([xmake, "-P", project, "-r"], project, env))
        program = project / "build-xmake" / plat / arch / "release" / ("hello.exe" if plat == "mingw" else "hello")
        headers = run([readobj, "--file-headers", program], project, env)
        if f"Format: {fmt}" not in headers or f"Arch: {object_arch}" not in headers:
            raise RuntimeError(f"Unexpected architecture for {plat}/{arch}: {headers}")
        needed = run([readobj, "--needed-libs", program], project, env)
        forbidden = ("libstdc++", "libc++", "libgcc", "libunwind", "winpthread")
        if any(name in needed.lower() for name in forbidden):
            raise RuntimeError(f"External C++ runtime dependency: {needed}")
        if (plat, arch) == (native_plat, native_arch):
            actual = run([xmake, "run", "-P", project, "hello"], project, env).strip()
            if actual != expected:
                raise RuntimeError(f"Unexpected program output: {actual!r}; expected {expected!r}")
        print(f"PASS {plat}/{arch}", flush=True)


if __name__ == "__main__":
    LOGS.mkdir(exist_ok=True)
    handler = logging.FileHandler(LOGS / "smoke.log", encoding="utf-8")
    messages = queue.Queue()
    listener = logging.handlers.QueueListener(messages, handler)
    logging.basicConfig(level=logging.INFO, handlers=[logging.handlers.QueueHandler(messages)])
    listener.start()
    try:
        main()
    except Exception:
        logging.exception("Xmake integration smoke test failed")
        raise
    finally:
        listener.stop()
        handler.close()
