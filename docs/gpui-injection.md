# Native GPUI insertion in Zed 1.27.0

```text
Onboarding composition
  -> existing Div::child<Divider>
  -> Frida entry callback filters caller and saves x8
  -> original child builder completes
  -> Frida return callback invokes the ARM64 bridge
  -> compiled Zed constructors and child specializations
  -> updated parent in original indirect result slot
  -> remaining onboarding composition
  -> GPUI layout, paint, hit testing, and event dispatch
```

## Identifying the boundary

The optimized release lacked the onboarding symbols used in the debug experiment. Onboarding text references in ARM64 `ADRP`/`ADD` sequences anchored manual disassembly. The [onboarding source at the reference revision](https://github.com/zed-industries/zed/blob/597c383bcd024b253c916b083e33d4abcc46fbe1/crates/onboarding/src/onboarding.rs#L365-L383) corroborates the Finish button, divider, and subsequent page composition. It is a source reference for the shape of the view. The compatibility contract is the observed compiled release.

The [release profile](../examples/zed-release-card/zed-release-card-arm64.js#L31-L58) checks the divider construction at image offset `0x0365027c`, the instruction that sets `x8` to `sp + 0xaf0` at `0x03650294`, and the branch-and-link at `0x036502a0`. The called specialization starts at `0x05442b98`. Other callers of the same specialization fall through unchanged. The return-address check identifies `0x036502a4` after relocation.

## Constructing and publishing the subtree

The agent captures the parent’s result slot before calling the original builder and uses it only during that invocation. The [bridge](../examples/zed-release-card/zed-release-card-arm64.js#L103-L184) receives the slot and raw scratch memory, then:

1. Calls the vertical flex helper at `0x0548e84c`.
2. Constructs a `Headline`, `Label`, and `Button` at `0x0541bce8`, `0x05418df0`, and `0x05419314`, respectively.
3. Calls their concrete child specializations at `0x05442cd8`, `0x05442e58`, and `0x05442f54`. It alternates two `Div` slots as each call consumes a parent and returns a new one.
4. Calls `Div::child<Div>` at `0x00dd3658` to add the card to the divider’s parent. It moves the resulting `0x548` bytes back into the original slot.

In [GPUI’s reference source](https://github.com/zed-industries/zed/blob/597c383bcd024b253c916b083e33d4abcc46fbe1/crates/gpui/src/element.rs#L193-L209), `ParentElement::child` converts its argument to `AnyElement` and extends the parent. The bridge uses compiled equivalents in the target’s own active render context. Zed continues traversing the same tree in the same window. This accounts for the observed placement, styling, layout, and input. The AppKit experiment adds an `NSTextField` subview through the Objective-C runtime and has no role in the release card. No framebuffer or compositor code is patched.

## Dispatch and reconstruction

The bridge writes an agent-owned closure representation into the constructed button and uses the fixed element ID `release-onboarding-setup-tips`. Zed’s [button implementation](https://github.com/zed-industries/zed/blob/597c383bcd024b253c916b083e33d4abcc46fbe1/crates/ui/src/components/button/button_like.rs#L882-L889) forwards its click to the listener. The reference [GPUI mouse-up path](https://github.com/zed-industries/zed/blob/597c383bcd024b253c916b083e33d4abcc46fbe1/crates/gpui/src/elements/div.rs#L3191-L3224) requests a refresh during capture and calls the listener during bubble. The callback flips an agent boolean and the next render reconstructs the card with updated text. The host state is untouched by the callback. The boolean is shared by all matching renders in one agent session.

The current agent creates elements inside an existing view. It creates no new GPUI entity and replaces no `Render::render` implementation. It has no entity enumeration, component registry, arbitrary insertion API, stable Rust ABI, or WASM boundary. A named slot can represent this known composition boundary across adapters without requiring a scanner to recover type identity, relationships, and lifetimes from arbitrary optimized Rust objects. The slot remains a [proposal](architecture.md).
