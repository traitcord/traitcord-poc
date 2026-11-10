// SPDX-License-Identifier: GPL-3.0-only

//! Example mod implementing the native title and GPUI render contracts.

use std::ffi::c_char;

#[unsafe(no_mangle)]
pub extern "C" fn gpui_mod_v1_title_prefix() -> *const c_char {
    c"[MODDED] ".as_ptr()
}

#[unsafe(no_mangle)]
pub extern "C" fn gpui_mod_v2_configure(patch: &mut poc_ui::RawUiPatch) {
    patch.heading = c"Heading replaced by the mod".as_ptr();
    patch.button = c"Run mod action".as_ptr();
    patch.button_message = c"Custom button handled by GPUI".as_ptr();
}
