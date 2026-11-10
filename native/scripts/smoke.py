# SPDX-License-Identifier: GPL-3.0-only

"""Check the injected title and badge in a fresh GPUI process."""

import argparse
import os
from pathlib import Path
import signal
import subprocess
import sys
import tempfile

WORKSPACE = Path(__file__).resolve().parents[2]
BUILD = WORKSPACE / "native/target/debug"
TITLE_CHANGED = "[gpui-mod] GPUI window title changed (read back from AppKit)"
BADGE_ATTACHED = "[gpui-mod] custom AppKit badge attached"


def probe(command, timeout):
    with subprocess.Popen(
        command, stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
        text=True, errors="replace", start_new_session=True,
    ) as child:
        try:
            output, _ = child.communicate(timeout=timeout)
            return output, child.returncode
        except subprocess.TimeoutExpired:
            try:
                os.killpg(child.pid, signal.SIGTERM)
            except ProcessLookupError:
                pass
            try:
                output, _ = child.communicate(timeout=3)
            except subprocess.TimeoutExpired:
                os.killpg(child.pid, signal.SIGKILL)
                output, _ = child.communicate()
            return output, None


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("app", choices=("calculator", "zed"))
    parser.add_argument("--seconds", type=float, default=8)
    options = parser.parse_args()
    with tempfile.TemporaryDirectory(prefix="gpui-mod-smoke-") as scratch:
        if options.app == "zed":
            binary = WORKSPACE / "zed/target/debug/zed"
            baseline_args = ["--user-data-dir", str(Path(scratch) / "baseline")]
            modded_args = ["--user-data-dir", str(Path(scratch) / "modded")]
        else:
            binary = WORKSPACE / "gpui-calculator/target/debug/rust-calculator"
            baseline_args = modded_args = []
        baseline, baseline_exit = probe([binary, *baseline_args], 3)
        modded, modded_exit = probe(
            [BUILD / "poc_injector", binary, BUILD / "libpoc_mod_example.dylib", *modded_args],
            options.seconds,
        )
    markers = (TITLE_CHANGED, BADGE_ATTACHED)
    if baseline_exit is None and modded_exit is None and all(
        marker not in baseline and marker in modded for marker in markers
    ):
        print(f"PASS: {options.app}: injected mod changed the title and attached a native badge")
        return 0
    print(f"FAIL: {options.app}: could not verify both title and badge", file=sys.stderr)
    print(f"Baseline (exit={baseline_exit}):\n{baseline}", file=sys.stderr)
    print(f"Modded (exit={modded_exit}):\n{modded}", file=sys.stderr)
    return 1


if __name__ == "__main__":
    sys.exit(main())
