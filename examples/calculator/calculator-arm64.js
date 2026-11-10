// SPDX-License-Identifier: GPL-3.0-only

// Load before resuming the verified Calculator process. Offsets are relative to __TEXT.
const expectedUuid = "f23d4c7f8c5336d9a386c6827efeeB07".toLowerCase();
const image = Process.mainModule;

function imageUuid(base) {
    if (base.readU32() !== 0xfeedfacf)
        throw new Error("Expected a little-endian Mach-O64 executable");
    const count = base.add(16).readU32();
    const commandBytes = base.add(20).readU32();
    if (commandBytes > image.size - 32)
        throw new Error("Mach-O commands exceed the image");
    let offset = 32;
    const end = offset + commandBytes;
    for (let index = 0; index < count && offset + 8 <= end; index++) {
        const command = base.add(offset);
        const size = command.add(4).readU32();
        if (size < 8 || offset + size > end)
            break;
        if (command.readU32() === 0x1b && size === 24) {
            const bytes = new Uint8Array(command.add(8).readByteArray(16));
            return Array.from(bytes, byte => byte.toString(16).padStart(2, "0")).join("");
        }
        offset += size;
    }
    throw new Error("Mach-O LC_UUID missing");
}

if (Process.platform !== "darwin" || Process.arch !== "arm64" ||
    imageUuid(image.base) !== expectedUuid || Process.codeSigningPolicy === "required")
    throw new Error("Unsupported Calculator build or code-signing policy");

const edits = [
    // Primary (equals) button background: #f66670 -> #116b62.
    { offset: 0x9e9c, expected: 0x528cce08, replacement: 0x528d6c48 },
    { offset: 0x9ea0, expected: 0x72a01ec8, replacement: 0x72a00228 },
    // Its hover background: #c65258 -> #0b514a.
    { offset: 0x9eb4, expected: 0x528a4b08, replacement: 0x528a2948 },
    { offset: 0x9eb8, expected: 0x72a018c8, replacement: 0x72a00168 },
    // Only the Plus label arm uses the existing one-byte "x" slice instead of "+".
    { offset: 0xa128, expected: 0x910ca800, replacement: 0x910ca000 },
    // Only the Plus computation uses fmul d0, d0, d1 instead of fadd.
    { offset: 0xb3ac, expected: 0x1e612800, replacement: 0x1e610800 },
];

for (const edit of edits) {
    const address = image.base.add(edit.offset);
    if (address.readU32() !== edit.expected)
        throw new Error(`Original instruction mismatch at +0x${edit.offset.toString(16)}`);
}

if (image.base.add(0xa124).readU32() !== 0xf0002be0 ||
    image.base.add(0x58932a).readU8() !== 0x2b ||
    image.base.add(0x589328).readU8() !== 0x78)
    throw new Error("Button label location or bytes changed");

const start = edits[0].offset;
const end = edits[edits.length - 1].offset + 4;
const address = image.base.add(start);
const range = Process.getRangeByAddress(address);
if (!range.protection.includes("x") ||
    image.base.add(end).compare(range.base.add(range.size)) > 0)
    throw new Error("Patch sites must lie in the same executable mapping");

Memory.patchCode(address, end - start, writable => {
    for (const edit of edits)
        writable.add(edit.offset - start).writeU32(edit.replacement);
});
for (const edit of edits) {
    if (image.base.add(edit.offset).readU32() !== edit.replacement)
        throw new Error(`Patched instruction readback failed at +0x${edit.offset.toString(16)}`);
}
send({ event: "calculator-patched", uuid: expectedUuid, base: image.base.toString(), edits: edits.length });
