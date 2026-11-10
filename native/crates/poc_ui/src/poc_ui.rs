// SPDX-License-Identifier: GPL-3.0-only

//! Native plugin contract shared by the desktop adapters.

use libloading::Library;
use std::error::Error;
use std::ffi::{c_char, CStr};
use std::path::Path;

pub type LoadError = Box<dyn Error>;

/// Version 2 adds UI slots. The host copies all strings before unloading the plugin.
/// The output slot is borrowed only for the duration of the call.
pub type ConfigureUi = unsafe extern "C" fn(&mut RawUiPatch);
pub const CONFIGURE_UI_SYMBOL: &[u8] = b"gpui_mod_v2_configure\0";

#[repr(C)]
pub struct RawUiPatch {
    pub heading: *const c_char,
    pub button: *const c_char,
    pub button_message: *const c_char,
}

pub struct UiPatch {
    pub heading: String,
    pub button: String,
    pub button_message: String,
}

impl UiPatch {
    /// # Safety
    /// The caller must trust the selected native library and its ABI implementation.
    pub unsafe fn load(path: &Path) -> Result<Self, LoadError> {
        if !path.is_absolute() {
            return Err("mod path must be absolute".into());
        }
        let library = unsafe { Library::new(path)? };
        let configure = unsafe { library.get::<ConfigureUi>(CONFIGURE_UI_SYMBOL)? };
        unsafe { Self::read(*configure) }
    }

    /// # Safety
    /// The library must implement the version 2 ABI with valid NUL-terminated UTF-8 strings.
    pub unsafe fn read(configure: ConfigureUi) -> Result<Self, LoadError> {
        let mut patch = RawUiPatch {
            heading: std::ptr::null(),
            button: std::ptr::null(),
            button_message: std::ptr::null(),
        };
        unsafe { configure(&mut patch) };
        Ok(Self {
            heading: unsafe { copy_string(patch.heading, "heading")? },
            button: unsafe { copy_string(patch.button, "button")? },
            button_message: unsafe { copy_string(patch.button_message, "button_message")? },
        })
    }
}

unsafe fn copy_string(value: *const c_char, field: &str) -> Result<String, LoadError> {
    if value.is_null() {
        return Err(format!("mod did not set {field}").into());
    }
    let value = unsafe { CStr::from_ptr(value) }.to_str()?;
    if value.trim().is_empty() || value.chars().count() > 80 {
        return Err(format!("{field} must contain 1 to 80 characters").into());
    }
    Ok(value.to_owned())
}
