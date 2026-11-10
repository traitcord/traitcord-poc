// SPDX-License-Identifier: GPL-3.0-only

use libloading::Library;
use poc_ui::{ConfigureUi, UiPatch, CONFIGURE_UI_SYMBOL};
use std::ffi::{c_char, c_void, CStr, CString};
use std::path::Path;
use std::sync::OnceLock;

type Object = *mut c_void;
type Selector = *const c_void;
type Imp = unsafe extern "C" fn(Object, Selector, Object);
type ResponderImp = unsafe extern "C" fn(Object, Selector, Object) -> bool;
type Prefix = unsafe extern "C" fn() -> *const c_char;

#[link(name = "AppKit", kind = "framework")]
unsafe extern "C" {}
#[link(name = "objc")]
unsafe extern "C" {
    fn objc_getClass(name: *const c_char) -> Object;
    fn object_getClassName(object: Object) -> *const c_char;
    fn sel_registerName(name: *const c_char) -> Selector;
    fn class_getInstanceMethod(class: Object, selector: Selector) -> Object;
    fn method_getImplementation(method: Object) -> *const c_void;
    fn method_setImplementation(method: Object, implementation: *const c_void) -> *const c_void;
    fn objc_msgSend();
}
unsafe extern "C" {
    fn pthread_main_np() -> i32;
}

static NATIVE_BADGE: OnceLock<CString> = OnceLock::new();
static NATIVE_PLUGIN: OnceLock<Library> = OnceLock::new();
static PREFIX: OnceLock<CString> = OnceLock::new();
static ORIGINAL_TITLE: OnceLock<Imp> = OnceLock::new();
static ORIGINAL_RESPONDER: OnceLock<ResponderImp> = OnceLock::new();

#[used]
#[unsafe(link_section = "__DATA,__mod_init_func")]
static CONSTRUCTOR: extern "C" fn() = bootstrap;

extern "C" fn bootstrap() {
    if let Err(error) = install() {
        eprintln!("[gpui-mod] {error}");
    }
}

fn install() -> Result<(), String> {
    let plugin = std::env::var_os("POC_MOD").ok_or("POC_MOD is unset")?;
    let plugin = Path::new(&plugin);
    if !plugin.is_absolute() {
        return Err("POC_MOD must be an absolute path".into());
    }
    // The launcher takes an explicit path to a trusted native plugin.
    unsafe {
        let library = Library::new(plugin).map_err(|error| error.to_string())?;
        let prefix = library
            .get::<Prefix>(b"gpui_mod_v1_title_prefix\0")
            .map_err(|error| error.to_string())?;
        let prefix = prefix();
        if prefix.is_null() {
            return Err("mod returned a null prefix".into());
        }
        let prefix = CStr::from_ptr(prefix);
        if prefix
            .to_str()
            .map_err(|error| error.to_string())?
            .is_empty()
        {
            return Err("mod returned an empty prefix".into());
        }

        let class = objc_getClass(c"NSWindow".as_ptr());
        if class.is_null() {
            return Err("AppKit NSWindow is unavailable".into());
        }
        let title_method = class_getInstanceMethod(class, selector(c"setTitle:"));
        let responder_method = class_getInstanceMethod(class, selector(c"makeFirstResponder:"));
        if title_method.is_null() || responder_method.is_null() {
            return Err("AppKit window methods are unavailable".into());
        }

        if let Ok(configure) = library.get::<ConfigureUi>(CONFIGURE_UI_SYMBOL) {
            match UiPatch::read(*configure) {
                Ok(patch) => {
                    let badge = CString::new(patch.heading).map_err(|error| error.to_string())?;
                    NATIVE_BADGE.set(badge).map_err(|_| "badge already set")?;
                }
                Err(error) => eprintln!("[gpui-mod] native badge unavailable: {error}"),
            }
        }
        PREFIX
            .set(prefix.to_owned())
            .map_err(|_| "prefix already set")?;
        ORIGINAL_TITLE
            .set(std::mem::transmute::<*const c_void, Imp>(
                method_getImplementation(title_method),
            ))
            .map_err(|_| "title hook already set")?;
        ORIGINAL_RESPONDER
            .set(std::mem::transmute::<*const c_void, ResponderImp>(
                method_getImplementation(responder_method),
            ))
            .map_err(|_| "responder hook already set")?;
        NATIVE_PLUGIN
            .set(library)
            .map_err(|_| "plugin already loaded")?;
        method_setImplementation(title_method, set_title as *const c_void);
        method_setImplementation(responder_method, make_first_responder as *const c_void);
    }
    eprintln!("[gpui-mod] installed AppKit hooks");
    Ok(())
}

fn selector(name: &CStr) -> Selector {
    // Objective-C interns the selector name; it does not borrow this string.
    unsafe { sel_registerName(name.as_ptr()) }
}

fn class_is(object: Object, expected: &CStr) -> bool {
    unsafe {
        if object.is_null() {
            return false;
        }
        let name = object_getClassName(object);
        !name.is_null() && CStr::from_ptr(name) == expected
    }
}

fn is_gpui_window(window: Object) -> bool {
    (unsafe { pthread_main_np() != 0 })
        && (class_is(window, c"GPUIWindow") || class_is(window, c"GPUIPanel"))
}

unsafe extern "C" fn set_title(window: Object, command: Selector, title: Object) {
    if let Some(original) = ORIGINAL_TITLE.get() {
        let replacement = if is_gpui_window(window) {
            unsafe { decorate(title) }
        } else {
            None
        };
        unsafe { original(window, command, replacement.unwrap_or(title)) };
        if let Some(replacement) = replacement {
            let matches = unsafe {
                let equals: unsafe extern "C" fn(Object, Selector, Object) -> bool =
                    std::mem::transmute(objc_msgSend as unsafe extern "C" fn());
                let actual = window_title(window);
                !actual.is_null() && equals(actual, selector(c"isEqualToString:"), replacement)
            };
            if matches {
                eprintln!("[gpui-mod] GPUI window title changed (read back from AppKit)");
            }
        }
    }
}

unsafe extern "C" fn make_first_responder(
    window: Object,
    command: Selector,
    responder: Object,
) -> bool {
    let Some(original) = ORIGINAL_RESPONDER.get() else {
        return false;
    };
    let changed = unsafe { original(window, command, responder) };
    if is_gpui_window(window) && class_is(responder, c"GPUIView") {
        // Decorate windows whose apps never explicitly assign a title.
        unsafe {
            set_title(window, selector(c"setTitle:"), window_title(window));
            add_native_badge(window);
        }
    }
    changed
}

unsafe fn window_title(window: Object) -> Object {
    unsafe {
        let get_title: unsafe extern "C" fn(Object, Selector) -> Object =
            std::mem::transmute(objc_msgSend as unsafe extern "C" fn());
        get_title(window, selector(c"title"))
    }
}

// NSStrings stay inside AppKit and live through the synchronous setter call.
unsafe fn decorate(title: Object) -> Option<Object> {
    let prefix = PREFIX.get()?;
    unsafe {
        let append: unsafe extern "C" fn(Object, Selector, Object) -> Object =
            std::mem::transmute(objc_msgSend as unsafe extern "C" fn());
        let has_prefix: unsafe extern "C" fn(Object, Selector, Object) -> bool =
            std::mem::transmute(objc_msgSend as unsafe extern "C" fn());

        let prefix = ns_string(prefix);
        if prefix.is_null()
            || (!title.is_null() && has_prefix(title, selector(c"hasPrefix:"), prefix))
        {
            return None;
        }
        if title.is_null() {
            return Some(prefix);
        }
        let result = append(prefix, selector(c"stringByAppendingString:"), title);
        (!result.is_null()).then_some(result)
    }
}

// This view belongs to AppKit. GPUI draws its scene in the neighboring view.
unsafe fn add_native_badge(window: Object) {
    let Some(text) = NATIVE_BADGE.get() else {
        return;
    };
    const BADGE_TAG: isize = 0x4750_5549;
    #[repr(C)]
    struct Point {
        x: f64,
        y: f64,
    }

    unsafe {
        let get_object: unsafe extern "C" fn(Object, Selector) -> Object =
            std::mem::transmute(objc_msgSend as unsafe extern "C" fn());
        let find_tag: unsafe extern "C" fn(Object, Selector, isize) -> Object =
            std::mem::transmute(objc_msgSend as unsafe extern "C" fn());
        let make_label: unsafe extern "C" fn(Object, Selector, Object) -> Object =
            std::mem::transmute(objc_msgSend as unsafe extern "C" fn());
        let set_tag: unsafe extern "C" fn(Object, Selector, isize) =
            std::mem::transmute(objc_msgSend as unsafe extern "C" fn());
        let set_bool: unsafe extern "C" fn(Object, Selector, bool) =
            std::mem::transmute(objc_msgSend as unsafe extern "C" fn());
        let set_point: unsafe extern "C" fn(Object, Selector, Point) =
            std::mem::transmute(objc_msgSend as unsafe extern "C" fn());
        let set_object: unsafe extern "C" fn(Object, Selector, Object) =
            std::mem::transmute(objc_msgSend as unsafe extern "C" fn());
        let send_void: unsafe extern "C" fn(Object, Selector) =
            std::mem::transmute(objc_msgSend as unsafe extern "C" fn());

        let content = get_object(window, selector(c"contentView"));
        if content.is_null() || !find_tag(content, selector(c"viewWithTag:"), BADGE_TAG).is_null() {
            return;
        }
        let text = ns_string(text);
        let label = make_label(
            objc_getClass(c"NSTextField".as_ptr()),
            selector(c"labelWithString:"),
            text,
        );
        if label.is_null() {
            return;
        }
        let color = get_object(
            objc_getClass(c"NSColor".as_ptr()),
            selector(c"controlBackgroundColor"),
        );
        set_object(label, selector(c"setBackgroundColor:"), color);
        set_bool(label, selector(c"setDrawsBackground:"), true);
        set_tag(label, selector(c"setTag:"), BADGE_TAG);
        send_void(label, selector(c"sizeToFit"));
        set_point(
            label,
            selector(c"setFrameOrigin:"),
            Point { x: 8.0, y: 8.0 },
        );
        set_object(content, selector(c"addSubview:"), label);
        if find_tag(content, selector(c"viewWithTag:"), BADGE_TAG) == label {
            eprintln!("[gpui-mod] custom AppKit badge attached");
        }
    }
}

unsafe fn ns_string(text: &CStr) -> Object {
    unsafe {
        let make_string: unsafe extern "C" fn(Object, Selector, *const c_char) -> Object =
            std::mem::transmute(objc_msgSend as unsafe extern "C" fn());
        make_string(
            objc_getClass(c"NSString".as_ptr()),
            selector(c"stringWithUTF8String:"),
            text.as_ptr(),
        )
    }
}
