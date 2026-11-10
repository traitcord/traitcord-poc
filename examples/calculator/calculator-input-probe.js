// SPDX-License-Identifier: GPL-3.0-only

// Input probe for the profiled Calculator build.
// Posts AppKit events from inside the owned process so no global input access is needed.
const calculator = Process.mainModule;
const resultFunction = calculator.base.add(0xb2b4);
if (Process.platform !== "darwin" || Process.arch !== "arm64" ||
    resultFunction.readU32() !== 0xd10183ff ||
    calculator.base.add(0xb3e4).readU32() !== 0xfd000800)
    throw new Error("Unexpected Calculator build for input probe");

let remainingResults = 3;
Interceptor.attach(resultFunction, {
    onEnter(args) {
        const logic = args[0];
        this.logic = logic;
        this.left = logic.add(0x10).readDouble();
        this.right = logic.add(0x8).readDouble();
        this.operation = logic.add(0x19).readU8();
    },
    onLeave() {
        if (remainingResults-- > 0)
            send({ event: "calculator-result", left: this.left, right: this.right,
                operation: this.operation, result: this.logic.add(0x10).readDouble() });
    },
});

function exported(name) {
    return Module.getGlobalExportByName(name);
}
const getClass = new NativeFunction(exported("objc_getClass"), "pointer", ["pointer"]);
const getSelector = new NativeFunction(exported("sel_registerName"), "pointer", ["pointer"]);
const sendMessage = exported("objc_msgSend");
const getObject = new NativeFunction(sendMessage, "pointer", ["pointer", "pointer"]);
const getInteger = new NativeFunction(sendMessage, "long", ["pointer", "pointer"]);
const makeString = new NativeFunction(sendMessage, "pointer", ["pointer", "pointer", "pointer"]);
const postEvent = new NativeFunction(sendMessage, "void", ["pointer", "pointer", "pointer", "uchar"]);
const makeKeyEvent = new NativeFunction(sendMessage, "pointer", [
    "pointer", "pointer", "ulong", ["double", "double"], "ulong", "double", "long",
    "pointer", "pointer", "pointer", "uchar", "uint16",
]);
const dispatchMain = new NativeFunction(exported("dispatch_async_f"), "void",
    ["pointer", "pointer", "pointer"]);
const mainQueue = exported("_dispatch_main_q");
const classNamed = name => getClass(Memory.allocUtf8String(name));
const selector = name => getSelector(Memory.allocUtf8String(name));

const input = [
    ["2", 19], ["+", 24], ["3", 20], ["\r", 36], // Baseline 5, patched 6.
    ["\x7f", 51], ["8", 28], ["-", 27], ["3", 20], ["\r", 36], // Both 5.
    ["\x7f", 51], ["2", 19], ["+", 24], ["3", 20], ["\r", 36], // Leave result visible.
];

let inputIndex = 0;
let attempts = 0;
const onMain = new NativeCallback(() => {
    try {
        const app = getObject(classNamed("NSApplication"), selector("sharedApplication"));
        const window = getObject(app, selector("keyWindow"));
        if (window.isNull()) {
            if (++attempts >= 40)
                send({ event: "probe-failed", reason: "Calculator has no key window" });
            else
                setTimeout(schedule, 125);
            return;
        }
        const [key, code] = input[inputIndex++];
        const value = makeString(classNamed("NSString"), selector("stringWithUTF8String:"),
            Memory.allocUtf8String(key));
        const event = makeKeyEvent(classNamed("NSEvent"),
            selector("keyEventWithType:location:modifierFlags:timestamp:windowNumber:context:characters:charactersIgnoringModifiers:isARepeat:keyCode:"),
            10, [0, 0], 0, 0, getInteger(window, selector("windowNumber")),
            NULL, value, value, 0, code);
        if (event.isNull())
            throw new Error("AppKit did not construct a key event");
        postEvent(app, selector("postEvent:atStart:"), event, 0);
        if (inputIndex < input.length)
            setTimeout(schedule, 100);
    } catch (error) {
        send({ event: "probe-failed", reason: String(error) });
    }
}, "void", ["pointer"]);

function schedule() {
    dispatchMain(mainQueue, NULL, onMain);
}

setTimeout(schedule, 250);
