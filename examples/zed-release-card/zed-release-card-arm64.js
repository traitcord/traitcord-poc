// SPDX-License-Identifier: GPL-3.0-only

// Zed 1.27.0 (20261104.154313), ARM64. Load in the locally signed release copy.
const image = Process.mainModule;
const at = offset => image.base.add(offset);
const expectedUuid = "d113655664ff3889b72d2ac16ac81b46";

function mappedUuid() {
    if (at(0).readU32() !== 0xfeedfacf)
        throw new Error("Expected Mach-O64");
    const count = at(16).readU32();
    const end = 32 + at(20).readU32();
    if (end > image.size)
        throw new Error("Invalid Mach-O command bounds");
    let offset = 32;
    for (let index = 0; index < count && offset + 8 <= end; index++) {
        const command = at(offset);
        const size = command.add(4).readU32();
        if (size < 8 || size > end - offset)
            break;
        if (command.readU32() === 0x1b && size === 24)
            return Array.from(new Uint8Array(command.add(8).readByteArray(16)),
                byte => byte.toString(16).padStart(2, "0")).join("");
        offset += size;
    }
    throw new Error("Missing Mach-O UUID");
}

if (Process.platform !== "darwin" || Process.arch !== "arm64" ||
    Process.codeSigningPolicy === "required" || mappedUuid() !== expectedUuid)
    throw new Error("Unsupported Zed release or code-signing policy");

const native = {
    vFlex:         [0x0548e84c, 0xa9bc6ffc],
    headline:      [0x0541bce8, 0xa9be4ff4],
    label:         [0x05418df0, 0xa9bd57f6],
    childHeadline: [0x05442cd8, 0xd10143ff],
    childLabel:    [0x05442e58, 0xd10143ff],
    button:        [0x05419314, 0xa9bd57f6],
    childButton:   [0x05442f54, 0xd10143ff],
    childDiv:      [0x00dd3658, 0xd10143ff],
    childDivider:  [0x05442b98, 0xd10143ff],
};
const returnOffset = 0x036502a4;
for (const [offset, instruction] of [
    ...Object.values(native),
    [0x0365027c, 0x9478e0b4], // Divider construction.
    [0x03650294, 0x912bc3e8], // Parent result slot, sp + 0xaf0.
    [0x036502a0, 0x9477ca3e], // Append the divider.
    [0x00dd8000, 0x5280a902], // Div move copies 0x548 bytes.
    [0x054e0f74, 0x3917427f], // Label writes through offset 0x5d0.
    [0x036501b4, 0x94772458], // Button::new(&str, &str).
    [0x03650268, 0x9477cb3b], // Div::child<Button>.
    [0x0365c888, 0xf9152ff6], // Finish button's click data at Button + 0x648.
    [0x0365c894, 0xf91533e8], // Finish button's click vtable at Button + 0x650.
    [0x054d3a80, 0xb9087a68], // Button constructor writes through offset 0x878.
]) {
    if (offset + 4 > image.size || at(offset).readU32() !== instruction)
        throw new Error(`Instruction fingerprint failed at +0x${offset.toString(16)}`);
}

// Static Rust string slices can outlive the script. Keep their backing strings
// for the lifetime of this Zed process.
const duplicate = new NativeFunction(Module.getGlobalExportByName("strdup"), "pointer", ["pointer"]);
function staticText(text) {
    const bytes = duplicate(Memory.allocUtf8String(text));
    if (bytes.isNull())
        throw new Error("Could not allocate card text");
    return { bytes, length: text.length };
}
const title = staticText("Your setup, your way");
const buttonId = staticText("release-onboarding-setup-tips");
const collapsedBody = staticText("Start with a familiar keymap. You can change these choices any time.");
const expandedBody = staticText("Pick the editor shortcuts you already know. You can change your keymap later in Settings.");
const showTips = staticText("Show setup tips");
const hideTips = staticText("Hide setup tips");

let expanded = false;
let clickCount = 0;
let renderCount = 0;
const onClick = new NativeCallback((_closure, _event, _window, _app) => {
    expanded = !expanded;
    clickCount++;
    // GPUI clears its pending press and schedules a redraw during mouse-up.
    send({ event: "zed-release-card-clicked", expanded, click: clickCount });
}, "void", ["pointer", "pointer", "pointer", "pointer"]);

// Verify the existing zero-sized Finish Setup closure's vtable header. A Box
// holding our zero-sized closure has the same non-null sentinel and no drop.
const finishVtable = at(0x0a2d4be0);
if (!finishVtable.readPointer().isNull() ||
    finishVtable.add(8).readU64().toNumber() !== 0 ||
    finishVtable.add(16).readU64().toNumber() !== 1)
    throw new Error("Unexpected release click closure layout");
const clickVtable = Memory.alloc(0x30);
clickVtable.writePointer(NULL);
clickVtable.add(8).writeU64(0);
clickVtable.add(16).writeU64(1);
for (const offset of [0x18, 0x20, 0x28])
    clickVtable.add(offset).writePointer(onClick);

const textArguments = 0x1340;
const scratchBytes = textArguments + 0x20;

const bridge = Memory.alloc(Process.pageSize);
Memory.patchCode(bridge, Process.pageSize, writable => {
    const code = new Arm64Writer(writable, { pc: bridge });
    const call = name => {
        code.putLdrRegAddress("x16", at(native[name][0]));
        code.putBlrReg("x16");
    };

    // Two aligned 0x550-byte Div slots and one 0x8a0-byte element slot.
    const firstDiv = 0;
    const secondDiv = 0x550;
    const element = 0xaa0;
    const slot = (register, offset) => code.putAddRegRegImm(register, "x20", offset);
    code.putSubRegRegImm("sp", "sp", 0x20);
    code.putStrRegRegOffset("x19", "sp", 0);
    code.putStrRegRegOffset("x20", "sp", 8);
    code.putStrRegRegOffset("x29", "sp", 0x10);
    code.putStrRegRegOffset("x30", "sp", 0x18);
    code.putAddRegRegImm("x29", "sp", 0x10);
    code.putMovRegReg("x19", "x0");
    code.putMovRegReg("x20", "x1");

    slot("x8", firstDiv);
    // Compiler-generated Location passed by the original header's v_flex call.
    code.putLdrRegAddress("x0", at(0x0a2d9408));
    call("vFlex");
    for (const [text, constructor, child, input, output] of [
        [title, "headline", "childHeadline", firstDiv, secondDiv],
        [null, "label", "childLabel", secondDiv, firstDiv],
    ]) {
        slot("x8", element);
        if (text === null) {
            code.putLdrRegRegOffset("x0", "x20", textArguments);
            code.putLdrRegRegOffset("x1", "x20", textArguments + 8);
        } else {
            code.putLdrRegAddress("x0", text.bytes);
            code.putLdrRegU64("x1", text.length);
        }
        call(constructor);
        slot("x8", output);
        slot("x0", input);
        slot("x1", element);
        call(child);
    }

    slot("x8", element);
    code.putLdrRegAddress("x0", buttonId.bytes);
    code.putLdrRegU64("x1", buttonId.length);
    code.putLdrRegRegOffset("x2", "x20", textArguments + 0x10);
    code.putLdrRegRegOffset("x3", "x20", textArguments + 0x18);
    call("button");
    slot("x1", element);
    code.putLdrRegU64("x8", 1);
    code.putStrRegRegOffset("x8", "x1", 0x648);
    code.putLdrRegAddress("x8", clickVtable);
    code.putStrRegRegOffset("x8", "x1", 0x650);
    slot("x8", secondDiv);
    slot("x0", firstDiv);
    call("childButton");

    slot("x8", firstDiv);
    code.putMovRegReg("x0", "x19");
    slot("x1", secondDiv);
    call("childDiv");
    // Move the result to the original caller's slot without dropping scratch.
    code.putMovRegReg("x0", "x19");
    slot("x1", firstDiv);
    code.putLdrRegU64("x2", 0x548);
    code.putLdrRegAddress("x16", Module.getGlobalExportByName("memcpy"));
    code.putBlrReg("x16");

    code.putLdrRegRegOffset("x19", "sp", 0);
    code.putLdrRegRegOffset("x20", "sp", 8);
    code.putLdrRegRegOffset("x29", "sp", 0x10);
    code.putLdrRegRegOffset("x30", "sp", 0x18);
    code.putAddRegRegImm("sp", "sp", 0x20);
    code.putRet();
    code.flush();
});
if (!Memory.protect(bridge, Process.pageSize, "r-x"))
    throw new Error("Could not make the GPUI bridge executable");
const appendCard = new NativeFunction(bridge, "void", ["pointer", "pointer"]);

let enabled = true;
let reportedClick = -1;
Interceptor.attach(at(native.childDivider[0]), {
    onEnter() {
        if (enabled && this.returnAddress.equals(at(returnOffset)))
            this.parent = this.context.x8;
    },
    onLeave() {
        if (this.parent === undefined)
            return;
        const scratch = Memory.alloc(scratchBytes);
        const body = expanded ? expandedBody : collapsedBody;
        const label = expanded ? hideTips : showTips;
        scratch.add(textArguments).writePointer(body.bytes);
        scratch.add(textArguments + 8).writeU64(body.length);
        scratch.add(textArguments + 0x10).writePointer(label.bytes);
        scratch.add(textArguments + 0x18).writeU64(label.length);
        try {
            appendCard(this.parent, scratch);
        } catch (error) {
            enabled = false;
            throw error;
        }
        renderCount++;
        if (renderCount === 1)
            send({ event: "zed-release-card-added" });
        if (reportedClick !== clickCount) {
            reportedClick = clickCount;
            send({ event: "zed-release-card-rendered", expanded, click: clickCount, render: renderCount });
        }
    },
});
Interceptor.flush();
send({ event: "zed-release-card-hook-installed", uuid: expectedUuid });
