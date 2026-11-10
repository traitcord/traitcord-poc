# Verification records

## Zed release card

**Target:** Zed 1.27.0, build `20261104.154313`, macOS ARM64, UUID `D1136556-64FF-3889-B72D-2AC16AC81B46`. The locally signed bundle contains the original compiled instructions and the three deliberate literal edits.

**REA run.** Click 1 expanded the card. After resize to `1260 × 820`, the first input attempt found no key window. A later click collapsed the card at hook invocation 90. [Frida messages](zed-release-retained.json)

**Python runner.** On macOS 27.2.1 ARM64 with Python 3.14 and Frida 17.26.2, the card appeared above Theme. Native mouse events toggled the callback. The expanded text and **Hide setup tips** remained visible after resize to `1260 × 820`. The next click reported `expanded: false`, and Ctrl-C stopped the test process with exit status 130. The post-collapse redraw was observed in the REA run.

The official disk image and its executable matched the documented SHA-256 digests. The patcher rejected a mismatched executable. The release agent rejected the Calculator Mach-O before resume, and the runner exited with status 1.

## Other experiments

| Experiment and target | Original run | Standalone run |
| --- | --- | --- |
| Debug Zed ARM64, `597c383b` | Static card, replacement text, reordered sections, and working Finish navigation. | Patch and card insertion markers. |
| Calculator 0.1.0 debug ARM64, `1f0047c2` | For `2+3`, `8-3`, `2+3`, baseline returned `5, 5, 5` and patched returned `6, 5, 6`. Plus read `x` and Equals was teal. | Six edits applied. The input probe again returned `6, 5, 6`. |
| AppKit, macOS ARM64 | Title readback and badge attachment in debug Zed and Calculator. | Both smoke tests passed. |
| Cooperative host, GPUI `597c383b` | macOS keyboard test and Linux ARM64 input under Xvfb passed. Windows x64 cross-built. | macOS keyboard test passed. Windows runtime is unverified. |
