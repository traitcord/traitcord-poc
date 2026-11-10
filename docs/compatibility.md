# Compatibility and additional experiments

All three external Frida agents in this repository target macOS ARM64. They check the loaded Mach-O UUID and selected instructions before installing their hooks or making instruction edits. The release card also checks Frida’s signing policy. ASLR changes the image base. Recompilation can change the image-relative offsets, call sites, and Rust layouts. A UUID or a few instruction words can confirm selected facts about a known build. They do not prove semantic compatibility. The release patcher independently requires the exact original executable SHA-256 before copying or modifying a bundle.

| Profile | Required original executable identity | Source |
| --- | --- | --- |
| Zed 1.27.0, build `20261104.154313` | UUID `D1136556-64FF-3889-B72D-2AC16AC81B46`, SHA-256 `c9cc93ccb1f84d308f5bf39caed8c5a3f4179fd32af6d2f86e89414662fa403a` | Official disk image in the [quick start](../README.md#quick-start). The signed test copy has a different digest. |
| Zed debug, commit `597c383bcd024b253c916b083e33d4abcc46fbe1` | UUID `01F08625-2AA5-33A6-B7B2-85A22171E362`, SHA-256 `65445edb081d28b83de0cf84afd0fc592128a54f946e71b756c2ca358a9f4d3c` | Original local build. No matching public binary was identified. |
| Calculator 0.1.0 debug, commit `1f0047c25c60db1cd5133df501075a4138af3387` | UUID `F23D4C7F-8C53-36D9-A386-C6827EFEEB07`, SHA-256 `0150c825f432ef938dc7f51168d59becfd0384f5586b125ff7b77867455c01ed` | Original local build, GPUI dependency `5e1aa898`. No matching public binary was identified. |

Install Python and Frida as in the [quick start](../README.md#quick-start). Rebuilding the debug examples can change the UUID and offsets even with the same source and toolchain. A rejected rebuild requires a new profile.

## Debug Zed

Use an Apple Silicon Mac with Xcode tools, CMake, Rust 1.98.1, and a graphical session. See [Zed’s build documentation](https://zed.dev/docs/development/macos) for upstream prerequisites. Clone the reference source and build, or use the profiled original local binary if you have access to it.

```sh
git clone https://github.com/zed-industries/zed.git zed
git -C zed checkout 597c383bcd024b253c916b083e33d4abcc46fbe1
(cd zed && cargo +1.98.1 build --locked -p zed)
shasum -a 256 zed/target/debug/zed
```

Quit other Zed instances. Run the baseline with a fresh profile and quit after checking the original heading and Theme-before-Keymap order. Use the checkout as the working directory so the debug binary can resolve source-relative resources.

```sh
baseline=$(mktemp -d "${TMPDIR:-/tmp}/traitcord-zed-baseline.XXXXXX")
(cd zed && ./target/debug/zed --user-data-dir "$baseline")

profile=$(mktemp -d "${TMPDIR:-/tmp}/traitcord-zed-debug.XXXXXX")
(cd zed && ../.venv/bin/python ../scripts/run-frida.py ./target/debug/zed \
  ../examples/zed-onboarding/zed-onboarding-arm64.js \
  zed-onboarding-patched -- --user-data-dir "$profile")
```

Look for `zed-onboarding-patched` before resume and `zed-onboarding-card-added` after render. Check the new heading and subtitle, static card below the divider, and Base Keymap above Theme. The original Finish action should still navigate to Welcome. Quit Zed before closing Frida. The two branch edits live until the process exits. [Debug agent](../examples/zed-onboarding/zed-onboarding-arm64.js)

## Calculator

Use an Apple Silicon Mac with Xcode tools, Rust 1.98.1, and a graphical session. The upstream checkout and build are:

```sh
git clone https://github.com/kriskw1999/gpui-calculator.git gpui-calculator
git -C gpui-calculator checkout 1f0047c25c60db1cd5133df501075a4138af3387
(cd gpui-calculator && cargo +1.98.1 build --locked)
shasum -a 256 gpui-calculator/target/debug/rust-calculator
```

From the repository root, launch the original binary. Type `2+3` and press Enter. Expect `5` and the original button styling. Quit it before starting the modded run:

```sh
./gpui-calculator/target/debug/rust-calculator

.venv/bin/python scripts/run-frida.py ./gpui-calculator/target/debug/rust-calculator \
  examples/calculator/calculator-arm64.js calculator-patched
```

Look for `calculator-patched` with `edits: 6` before resume. The original Plus button now reads `x` and the equals button is teal. Typing `2+3` and pressing Enter produces `6`. Verify `8-3` still produces `5`. Quit the test process to restore the original behavior on next launch. The [optional input probe](../examples/calculator/calculator-input-probe.js) is the source used for the recorded three-result comparison. It can be loaded as a second script into the exact same process using public [REA](https://github.com/morluto/rea) or Frida’s Python API. The manual check needs only the included runner.

## Failure modes and cleanup

- Missing install marker, signing error, UUID mismatch, or instruction fingerprint failure: the runner exits and terminates its suspended test process. Check artifact identity before retrying. A missing marker should never be ignored.
- Installation marker without an insertion marker: check that the intended Zed instance launched, that no other instance took over, and that the profile opened onboarding.
- Frida denied by macOS: stop. Use a local test copy and a machine whose existing policy permits developer instrumentation. This workflow requires no system security or privileged changes.
- Quit normally to release the process before script teardown. Ctrl-C asks the runner to terminate its own test process. The runner reports agent errors but does not forward the child’s exit status. Delete the temporary profiles and test bundle when no longer needed.
- The separately tested AppKit loader and cooperative GPUI host are described in [native examples](../native/README.md).
