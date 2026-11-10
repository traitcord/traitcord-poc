# Proposed Traitcord architecture

```text
Target GPUI app
      ↕
Application/build compatibility adapter
      ↕
Traitcord Core
      ↕
Versioned capability and event API
      ↕
WebAssembly plugin runtime
```

The current [Zed agent](../examples/zed-release-card/zed-release-card-arm64.js) supplies one build profile. The layers above are planned.

- **Compatibility adapter.** Verify the binary before mutation. Own hook sites, calling conventions, native construction, foreground context, and callback lifetime.
- **Core.** Resolve named slots, validate widget descriptions, own plugin and view state, and route events and commands. A slot such as `onboarding.after-divider` names a capability at a known composition boundary. Each build maps it to a verified site. Discord needs its own adapter.
- **WASM boundary.** Deliver copied events and accept validated commands through a versioned interface. Use opaque, revocable handles and keep native pointers in the adapter. Bound guest execution and revoke queued commands on unload. [WIT reference](https://component-model.bytecodealliance.org/design/wit.html)

A composition boundary provides the parent and active render context. A scanner would need to recover identity, ownership, and lifetimes across erased, optimized Rust objects.

## Milestones

1. **Explicit update and removal.** Prove a post-startup update and removal on the release while the process remains open. Test redraw, resize, and navigation.
2. **Callback ownership and teardown.** Stop publishing the old control, replace frames that can retain it, drain in-flight calls, and then release callback storage. Verify repeated activation and removal.
3. **Second optimized Zed build.** Reproduce the same composition capability with a second profile. Verify rejection before mutation on a mismatch. Measure render and input cost.
4. **One named slot and a small declarative API.** Start with one control, one update command, and one event. Keep native lifetimes inside the adapter.
5. **One WASM plugin.** Exercise registration, a callback-driven update, resource bounds, and removal on unload.

## Instrumentation implementation choices

| Option | What it contributes | What still needs proof |
| --- | --- | --- |
| Rust-native adapter | Explicit ownership of Traitcord’s state and a narrow C-ABI bridge. Useful once a specific native seam is understood. | Correct host ABI, foreground access, callback retirement, and platform loading. Compiling another GPUI copy supplies none of these guarantees. |
| Frida RustModule | Prototype a native callback or move repeated work out of JS while retaining Frida’s discovery workflow. | Exact Rust signatures and layouts inside the target, toolchain constraints, and code lifetime after an intercepted frame is published. |
| Direct Frida Gum | Access the instrumentation layer used by Frida’s interceptor. May reduce JS crossings if measurement justifies it. | A loading mechanism, signing compatibility, and all target ABI and lifetime checks. |

See [Frida RustModule](https://frida.re/docs/javascript-api/#rustmodule) and [Gum](https://frida.re/docs/gum-api/). Compare these options after demonstrating explicit update, removal, and callback retirement.
