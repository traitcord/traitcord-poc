// SPDX-License-Identifier: GPL-3.0-only

// Profile for Zed 597c383b, debug arm64, UUID 01F08625-2AA5-33A6-B7B2-85A22171E362.
// Load while the process is suspended. All addresses are relative to __TEXT.
const image = Process.mainModule;
const address = offset => image.base.add(offset);
const uuid = "01f086252aa533a6b7b285a22171e362";

function mappedUuid() {
    if (image.base.readU32() !== 0xfeedfacf)
        throw new Error("Expected Mach-O64");
    const end = 32 + address(20).readU32();
    if (end > image.size)
        throw new Error("Invalid Mach-O command bounds");
    let offset = 32;
    for (let index = 0; index < address(16).readU32() && offset + 8 <= end; index++) {
        const command = address(offset);
        const size = command.add(4).readU32();
        if (size < 8 || size > end - offset)
            break;
        if (command.readU32() === 0x1b && size === 24) {
            return Array.from(new Uint8Array(command.add(8).readByteArray(16)),
                byte => byte.toString(16).padStart(2, "0")).join("");
        }
        offset += size;
    }
    throw new Error("Missing Mach-O UUID");
}

if (Process.platform !== "darwin" || Process.arch !== "arm64" ||
    Process.codeSigningPolicy === "required" || mappedUuid() !== uuid)
    throw new Error("Unsupported Zed build or code-signing policy");

const native = {
    vFlex:         [0x0e012690, 0xd10283ff],
    padding:       [0x0df67fa8, 0xd10383ff],
    background:    [0x10ea4fa0, 0xd10383ff],
    headline:      [0x0df6e438, 0xd101c3ff],
    label:         [0x0df31808, 0xd10543ff],
    childHeadline: [0x0df529f0, 0xd10283ff],
    childLabel:    [0x0df52e00, 0xd10603ff],
    childDiv:      [0x10ea5058, 0xd10383ff],
    childDivider:  [0x0df526a4, 0xa9be6ffc],
    theme:         [0x0339eb70, 0xa9be6ffc],
    keymap:        [0x0339ff6c, 0xa9be6ffc],
};
const themeCall = 0x0339e85c;
const keymapCall = 0x0339e8b0;
const signatures = [
    ...Object.values(native),
    [themeCall, 0x940000c5], [keymapCall, 0x940005af],
    [0x0337f010, 0x95223584], [0x0337f0a4, 0x95223413],
    [0x0337f608, 0x913063e8], [0x0337f618, 0x95223335],
    [0x0df5272c, 0x52800f08], // Existing Div result copy uses 0x78 bytes.
    [0x0df318bc, 0x3904011f], // Label writes through offset 0x100.
];
for (const [offset, word] of signatures) {
    if (offset + 4 > image.size || address(offset).readU32() !== word)
        throw new Error(`Instruction fingerprint failed at +0x${offset.toString(16)}`);
}
if (address(0x14454538).readUtf8String(14) !== "Welcome to Zed" ||
    address(0x14454546).readUtf8String(26) !== "The editor for what's next")
    throw new Error("Onboarding string fingerprints failed");

// The Rust constructors can retain a static string slice. Keep these four small
// allocations valid until the process exits, including after agent detach.
const duplicate = new NativeFunction(Module.getGlobalExportByName("strdup"), "pointer", ["pointer"]);
function staticText(text) {
    const bytes = duplicate(Memory.allocUtf8String(text));
    if (bytes.isNull())
        throw new Error("Could not allocate onboarding text");
    return { bytes, length: text.length }; // This profile uses ASCII text.
}
const title = staticText("Make Zed yours");
const subtitle = staticText("Start with your keys, then pick a theme.");
const cardTitle = staticText("Your setup, your way");
const cardBody = staticText("Start with a familiar keymap. You can change these choices any time.");

const background = Memory.alloc(16);
[0.51, 0.66, 0.47, 0.21].forEach((value, index) => background.add(index * 4).writeFloat(value));

// C entry: void append_card(Div *parent). Rust calls in this bridge use the
// inspected x8 indirect-result convention. A and B hold alternating Div moves.
const bridge = Memory.alloc(Process.pageSize);
Memory.patchCode(bridge, Process.pageSize, writable => {
    const code = new Arm64Writer(writable, { pc: bridge });
    const call = name => {
        code.putLdrRegAddress("x16", address(native[name][0]));
        code.putBlrReg("x16");
    };
    const slot = (reg, offset) => code.putAddRegRegImm(reg, "sp", offset);
    const divA = 0;
    const divB = 0x80;
    const element = 0x100; // 0x110 bytes before the saved-register area.
    code.putSubRegRegImm("sp", "sp", 0x240);
    code.putStrRegRegOffset("x19", "sp", 0x220);
    code.putStrRegRegOffset("x29", "sp", 0x228);
    code.putStrRegRegOffset("x30", "sp", 0x230);
    slot("x29", 0x228);
    code.putMovRegReg("x19", "x0");

    slot("x8", divA);
    // Reuse the valid track_caller Location from Zed's onboarding header.
    code.putLdrRegAddress("x0", address(0x1a631300));
    call("vFlex");
    slot("x8", divB);
    slot("x0", divA);
    call("padding");
    slot("x8", divA);
    slot("x0", divB);
    code.putLdrRegAddress("x1", background);
    call("background");

    for (const [text, constructor, child, input, output] of [
        [cardTitle, "headline", "childHeadline", divA, divB],
        [cardBody, "label", "childLabel", divB, divA],
    ]) {
        slot("x8", element);
        code.putLdrRegAddress("x0", text.bytes);
        code.putLdrRegU64("x1", text.length);
        call(constructor);
        slot("x8", output);
        slot("x0", input);
        slot("x1", element);
        call(child);
    }

    slot("x8", divB);
    code.putMovRegReg("x0", "x19");
    slot("x1", divA);
    call("childDiv");
    // Move the new parent into the original result slot. The scratch copy is
    // never reused or dropped, so the caller owns the only live value.
    code.putMovRegReg("x0", "x19");
    slot("x1", divB);
    code.putLdrRegU64("x2", 0x78);
    code.putLdrRegAddress("x16", Module.getGlobalExportByName("memcpy"));
    code.putBlrReg("x16");

    code.putLdrRegRegOffset("x19", "sp", 0x220);
    code.putLdrRegRegOffset("x29", "sp", 0x228);
    code.putLdrRegRegOffset("x30", "sp", 0x230);
    code.putAddRegRegImm("sp", "sp", 0x240);
    code.putRet();
    code.flush();
});
if (!Memory.protect(bridge, Process.pageSize, "r-x"))
    throw new Error("Could not make the GPUI bridge executable");
const appendCard = new NativeFunction(bridge, "void", ["pointer"]);

function replaceText(constructor, returnOffset, originalOffset, text) {
    Interceptor.attach(address(native[constructor][0]), {
        onEnter(args) {
            if (this.returnAddress.equals(address(returnOffset)) &&
                args[0].equals(address(originalOffset))) {
                args[0] = text.bytes;
                args[1] = ptr(text.length);
            }
        },
    });
}
replaceText("headline", 0x0337f014, 0x14454538, title);
replaceText("label", 0x0337f0a8, 0x14454546, subtitle);

let cardEnabled = true;
let firstCard = true;
Interceptor.attach(address(native.childDivider[0]), {
    onEnter() {
        if (cardEnabled && this.returnAddress.equals(address(0x0337f61c)))
            this.parent = this.context.x8;
    },
    onLeave() {
        if (this.parent === undefined)
            return;
        try {
            appendCard(this.parent);
        } catch (error) {
            cardEnabled = false;
            throw error;
        }
        if (firstCard) {
            firstCard = false;
            send({ event: "zed-onboarding-card-added" });
        }
    },
});

function branchLink(from, to) {
    return (0x94000000 | (((to - from) / 4) & 0x03ffffff)) >>> 0;
}
// Both section builders take (&mut tab_index, &mut App) and return Div in x8.
// Swapping their calls also puts their focus indices in the new visual order.
const first = branchLink(themeCall, native.keymap[0]);
const second = branchLink(keymapCall, native.theme[0]);
Memory.patchCode(address(themeCall), keymapCall - themeCall + 4, writable => {
    writable.writeU32(first);
    writable.add(keymapCall - themeCall).writeU32(second);
});
if (address(themeCall).readU32() !== first || address(keymapCall).readU32() !== second)
    throw new Error("Section order patch readback failed");
Interceptor.flush();
send({ event: "zed-onboarding-patched", uuid });
