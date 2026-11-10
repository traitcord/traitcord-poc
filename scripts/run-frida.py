# SPDX-License-Identifier: GPL-3.0-only

"""Spawn one test process, load an agent, and resume after its install marker."""

import argparse
import json
from pathlib import Path
import sys
from threading import Event

import frida

FRIDA_ERRORS = (
    frida.ExecutableNotFoundError,
    frida.ExecutableNotSupportedError,
    frida.InvalidArgumentError,
    frida.InvalidOperationError,
    frida.NotSupportedError,
    frida.OperationCancelledError,
    frida.PermissionDeniedError,
    frida.ProcessNotFoundError,
    frida.ProcessNotRespondingError,
    frida.ProtocolError,
    frida.ServerNotRunningError,
    frida.TimedOutError,
    frida.TransportError,
)


def run(executable, agent, marker, target_args):
    device = frida.get_local_device()
    source = agent.read_text(encoding="utf-8")
    install_finished = Event()
    stopped = Event()
    detached = Event()
    exited = Event()
    installed = Event()
    failed = Event()

    def on_message(message, _data):
        payload = message.get("payload")
        if message["type"] == "error":
            print(message.get("stack", message.get("description")), file=sys.stderr, flush=True)
            failed.set()
            install_finished.set()
            stopped.set()
        elif message["type"] == "send":
            print(json.dumps(payload, ensure_ascii=False), flush=True)
            if isinstance(payload, dict) and payload.get("event") == marker:
                installed.set()
                install_finished.set()
        else:
            print(json.dumps(message, ensure_ascii=False), flush=True)

    def on_detached(reason, crash):
        if reason == "process-terminated":
            exited.set()
        if reason != "process-terminated" or crash is not None:
            failed.set()
            print(f"Frida detached ({reason})", file=sys.stderr, flush=True)
        detached.set()
        stopped.set()
        install_finished.set()

    pid = None
    session = None
    script = None
    try:
        pid = device.spawn([str(executable), *target_args])
        session = device.attach(pid)
        session.on("detached", on_detached)
        script = session.create_script(source, name=agent.stem)
        script.on("message", on_message)
        script.load()
        install_finished.wait(10)
        if not installed.is_set() or failed.is_set() or stopped.is_set():
            print(f"Installation failed. Expected {marker!r}.", file=sys.stderr)
            return 1
        print(f"Received {marker}; resuming test process {pid}.", flush=True)
        device.resume(pid)
        stopped.wait()
        return 1 if failed.is_set() else 0
    except KeyboardInterrupt:
        return 130
    finally:
        # The current GPUI frame may still refer to the script's native callback.
        # Terminate the owned process before the session can release the script.
        if pid is not None and not exited.is_set():
            try:
                device.kill(pid)
            except frida.ProcessNotFoundError:
                pass
        if session is not None:
            if not detached.wait(3):
                session.detach()
            if script is not None:
                script.off("message", on_message)
            session.off("detached", on_detached)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("executable", type=Path)
    parser.add_argument("agent", type=Path)
    parser.add_argument("marker", help="expected agent event before resume")
    parser.add_argument("target_args", nargs=argparse.REMAINDER, metavar="TARGET_ARG")
    options = parser.parse_args()
    target_args = options.target_args
    if target_args[:1] == ["--"]:
        target_args = target_args[1:]
    try:
        executable = options.executable.resolve(strict=True)
        agent = options.agent.resolve(strict=True)
        return run(executable, agent, options.marker, target_args)
    except (OSError, *FRIDA_ERRORS) as error:
        print(f"run-frida: {error}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())
