# Native loader and cooperative host

These experiments use trusted C-ABI dynamic libraries. The macOS loader hooks AppKit window methods in an external GPUI process. The cooperative demo reads plugin-supplied strings at startup and builds its own GPUI UI, with a host-owned click handler and focus handle. Both are separate from the Zed release card.

## Build

Use Rust 1.98.1 and the normal native build tools for your platform. The cooperative host also uses a source checkout of Zed, outside this Cargo workspace. Run these commands from the repository root. If you already obtained the reference checkout for [debug Zed](../docs/compatibility.md#debug-zed), reuse it.

```sh
git clone https://github.com/zed-industries/zed.git zed
git -C zed checkout 597c383bcd024b253c916b083e33d4abcc46fbe1
cargo +1.98.1 build --manifest-path native/Cargo.toml --workspace --locked
cargo +1.98.1 build --manifest-path native/ui-demo/Cargo.toml --locked
```

The AppKit launcher and plugin build without the Zed checkout. The cooperative demo uses the same Rust source on macOS, Linux, and Windows. For Linux, use X11 or Wayland development libraries and the [upstream Linux build prerequisites](https://zed.dev/docs/development/linux). Use the same OS and architecture for the host and library.

## AppKit on macOS ARM64

Use a local debug GPUI executable that permits the native loader. The original verified hosts are the Calculator and Zed debug targets in [compatibility](../docs/compatibility.md). A rebuilt host can work with this launcher because the hook uses Objective-C selectors and class names, without the Frida profiles’ exact Rust offsets.

Run the corresponding app directly as the baseline. Run the launcher to see a `[MODDED]` title prefix and a tagged native badge. For Zed, quit any existing Zed instance and supply a fresh user-data directory with `--user-data-dir`.

```sh
native/target/debug/poc_injector gpui-calculator/target/debug/rust-calculator \
  native/target/debug/libpoc_mod_example.dylib
```

The automated smoke checks run a timed baseline and modded process. Each uses the applicable target at its documented checkout path. On a successful modded run, the loader reports that it installed AppKit hooks, read back the changed title, and attached the badge.

```sh
python3 native/scripts/smoke.py calculator
python3 native/scripts/smoke.py zed --seconds 12
```

Quit the app normally. A host that disallows the injected library, does not use the expected AppKit classes, or hands off to an existing process may never emit the markers. The AppKit title and badge are platform chrome.

## Cooperative GPUI host

Run the demo binary directly for the baseline heading. Then use the corresponding command from the repository root:

```sh
# macOS
native/target/debug/poc_injector --ui native/ui-demo/target/debug/poc_ui_demo \
  native/target/debug/libpoc_mod_example.dylib

# Linux
native/target/debug/poc_injector --ui native/ui-demo/target/debug/poc_ui_demo \
  native/target/debug/libpoc_mod_example.so
```

```powershell
# Windows
.\native\target\debug\poc_injector.exe --ui .\native\ui-demo\target\debug\poc_ui_demo.exe .\native\target\debug\poc_mod_example.dll
```

Expect a replacement heading and **Run mod action**. Activating the control toggles the plugin-supplied message. The demo uses visual feedback, with no expected install marker. An incompatible library or missing configure symbol produces a startup error. Close the demo to stop. The host’s keyboard regression test synthesizes Enter on the focused control:

```sh
cargo +1.98.1 test --manifest-path native/ui-demo/Cargo.toml --locked \
  focused_mod_control_handles_gpui_input
```

The C ABI exports `gpui_mod_v2_configure` with three NUL-terminated string pointers. The host copies the strings and releases its library handle before rendering. The plugin owns no GPUI object or live UI callback. See [evidence](../evidence/README.md) for the platform results.
