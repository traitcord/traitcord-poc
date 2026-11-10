# SPDX-License-Identifier: GPL-3.0-only

"""Patch the profiled Zed release in a fresh, locally signed test bundle."""

import argparse
import hashlib
from pathlib import Path
import subprocess
import sys
import tempfile

EXPECTED_SHA256 = "c9cc93ccb1f84d308f5bf39caed8c5a3f4179fd32af6d2f86e89414662fa403a"
EXECUTABLE = Path("Contents/MacOS/zed")
# File offsets in __TEXT,__const of the shipped Zed 1.27.0 ARM64 image.
EDITS = (
    (0x08117E8D, b"Finish Setup", b"Start Coding"),
    (0x08118C66, b"Welcome to Zed", b"Make Zed yours"),
    (0x08118C74, b"The editor for what's next", b"Pick a keymap and a theme."),
)


def sha256(path):
    with path.open("rb") as binary:
        return hashlib.file_digest(binary, "sha256").hexdigest()


def patch(source):
    if sha256(source / EXECUTABLE) != EXPECTED_SHA256:
        raise ValueError("expected the profiled Zed 1.27.0 ARM64 release")

    output = Path(__file__).resolve().parents[1] / "target"
    output.mkdir(exist_ok=True)
    lab = Path(tempfile.mkdtemp(prefix="zed-release-patched.", dir=output))
    app = lab / "Zed.app"
    subprocess.run(["/usr/bin/ditto", source, app], check=True)
    executable = app / EXECUTABLE
    if sha256(executable) != EXPECTED_SHA256:
        raise ValueError("copied executable did not match the release fingerprint")

    with executable.open("r+b") as binary:
        for offset, original, replacement in EDITS:
            binary.seek(offset)
            if len(original) != len(replacement) or binary.read(len(original)) != original:
                raise ValueError(f"literal fingerprint failed at 0x{offset:x}")
        for offset, _, replacement in EDITS:
            binary.seek(offset)
            if binary.write(replacement) != len(replacement):
                raise OSError(f"short write at 0x{offset:x}")

    # The installed helpers fail strict verification here. Sign inside out so
    # the outer bundle seals the copies of both helpers under the new identity.
    for item in (executable.with_name("cli"), executable.with_name("git"), app):
        subprocess.run(["/usr/bin/codesign", "--force", "--sign", "-", item], check=True)
    subprocess.run(["/usr/bin/codesign", "--verify", "--strict", app], check=True)
    with executable.open("rb") as binary:
        for offset, _, replacement in EDITS:
            binary.seek(offset)
            if binary.read(len(replacement)) != replacement:
                raise ValueError(f"signed executable readback failed at 0x{offset:x}")
    return app


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("source", nargs="?", type=Path, default=Path("/Applications/Zed.app"))
    args = parser.parse_args()
    try:
        print(patch(args.source.resolve(strict=True)))
    except (OSError, ValueError, subprocess.CalledProcessError) as error:
        print(f"patch-zed-release: {error}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
