# Traitcord PoC

Traitcord inserts an interactive GPUI card into the onboarding view of Zed 1.27.0 on macOS ARM64. Zed lays out and paints the card and dispatches its button clicks. The agent rebuilds the card on each matching render and preserves the selected state across resize. [Verification](evidence/README.md)

## How the release card works

The [runner](scripts/run-frida.py) starts Zed suspended, loads the [Frida agent](examples/zed-release-card/zed-release-card-arm64.js), and resumes after the install marker. The agent checks the platform, Mach-O UUID, and instruction fingerprints, then resolves the hook relative to the loaded image base.

The interceptor filters calls to `Div::child<Divider>` at image offset `0x05442b98` by return address and captures the caller’s indirect result slot.

```javascript
if (enabled && this.returnAddress.equals(at(returnOffset)))
    this.parent = this.context.x8;
```

After the original call returns, an ARM64 bridge uses Zed’s compiled builders to append a `Div` containing a `Headline`, `Label`, and `Button`. It moves the updated parent back into the caller’s result slot. A fabricated Rust closure vtable connects the button to a Frida callback. The callback toggles agent state, which the next render reads after GPUI’s mouse-up refresh. [Call sequence](docs/gpui-injection.md) · [ABI and lifetime assumptions](docs/rust-abi.md)

## Quick start

Use an Apple Silicon Mac with a graphical session and Python 3.11 or later. The target is **Zed 1.27.0, build `20261104.154313`, Mach-O UUID `D1136556-64FF-3889-B72D-2AC16AC81B46`**. Run these commands from the repository root.

```sh
python3 -m venv .venv
.venv/bin/python -m pip install -r scripts/requirements.txt

download_dir=$(mktemp -d "${TMPDIR:-/tmp}/traitcord-zed.XXXXXX")
curl -fL https://github.com/zed-industries/zed/releases/download/v1.27.0/Zed-aarch64.dmg \
  -o "$download_dir/Zed-aarch64.dmg"
printf '%s  %s\n' \
  8dcfdfaa94917cece0ff52ab6e3f7117c6647b78f32d266684cf0c13462d76a8 \
  "$download_dir/Zed-aarch64.dmg" | shasum -a 256 -c -
```

Continue only after the disk-image check reports `OK`. Create the disposable test bundle:

```sh
mkdir "$download_dir/mount"
hdiutil attach -readonly -nobrowse -mountpoint "$download_dir/mount" \
  "$download_dir/Zed-aarch64.dmg"
app=$(.venv/bin/python scripts/patch-zed-release.py "$download_dir/mount/Zed.app")
hdiutil detach "$download_dir/mount"
```

The patcher checks the executable digest and produces a locally signed copy under `target/` with three replacement onboarding strings. You can pass the exact original bundle directly to the patcher if you already have it. [Patcher source](scripts/patch-zed-release.py)

Quit other Zed instances to avoid single-instance handoff. For the baseline, launch the test copy without Frida. The heading should read **Make Zed yours**, with no card above Theme. Quit before starting the instrumented run.

```sh
baseline=$(mktemp -d "${TMPDIR:-/tmp}/traitcord-baseline.XXXXXX")
"$app/Contents/MacOS/zed" --user-data-dir "$baseline"
```

Run the native card experiment:

```sh
profile=$(mktemp -d "${TMPDIR:-/tmp}/traitcord-onboarding.XXXXXX")
.venv/bin/python scripts/run-frida.py "$app/Contents/MacOS/zed" \
  examples/zed-release-card/zed-release-card-arm64.js \
  zed-release-card-hook-installed -- --user-data-dir "$profile"
```

After `zed-release-card-hook-installed` and `zed-release-card-added`, click **Show setup tips** above Theme. Resize the window and check that **Hide setup tips** and the expanded text remain. Click again to collapse. The runner prints the click and render events with their `expanded` values. Quit Zed with Command-Q or terminate the test process with Ctrl-C.

## Other experiments

- [Debug Zed](docs/compatibility.md#debug-zed) inserts a static card, replaces onboarding text, and swaps Theme and Base Keymap.
- [Calculator](docs/compatibility.md#calculator) patches six instructions to change the Plus label and behavior and the equals button color.
- [Native examples](native/README.md) cover a macOS AppKit title and badge hook and a cooperative GPUI host that reads C ABI configuration at startup.

## Limits

The release hook is specific to one binary. GPUI can retain the fabricated callback vtable in an active frame, so keep the agent loaded until Zed exits. Keyboard focus, navigation, and external hooks on Windows and Linux are unverified. The next milestone is explicit UI update and removal while Zed stays open. [Compatibility](docs/compatibility.md) · [Architecture and roadmap](docs/architecture.md)

## License

Traitcord is licensed under [GPL-3.0-only](LICENSE). Target applications and dependencies retain their own licenses.
