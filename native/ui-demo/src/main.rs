// SPDX-License-Identifier: GPL-3.0-only

use gpui::{
    App, Bounds, Context, FocusHandle, Render, Role, SharedString, Window, WindowBounds,
    WindowOptions, div, prelude::*, px, rgb, size,
};
use poc_ui::UiPatch;
use std::path::Path;

struct Demo {
    heading: SharedString,
    control: Option<ModControl>,
    mod_action_ran: bool,
}

struct ModControl {
    label: SharedString,
    message: SharedString,
    focus: FocusHandle,
}

impl Demo {
    fn new(patch: Option<UiPatch>, window: &mut Window, cx: &mut Context<Self>) -> Self {
        let (heading, control) = match patch {
            Some(patch) => {
                let focus = cx.focus_handle();
                window.focus(&focus, cx);
                (
                    patch.heading.into(),
                    Some(ModControl {
                        label: patch.button.into(),
                        message: patch.button_message.into(),
                        focus,
                    }),
                )
            }
            None => ("Original GPUI heading".into(), None),
        };
        Self {
            heading,
            control,
            mod_action_ran: false,
        }
    }
}

impl Render for Demo {
    fn render(&mut self, _window: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        let mut content = div()
            .size_full()
            .flex()
            .flex_col()
            .items_start()
            .justify_center()
            .gap_4()
            .p_8()
            .bg(rgb(0x17212e))
            .text_color(rgb(0xf3f6fa))
            .child(div().id("heading").text_xl().child(self.heading.clone()))
            .child("This text belongs to the host.");

        if let Some(control) = &self.control {
            content = content.child(
                div()
                    .id("mod-button")
                    .role(Role::Button)
                    .track_focus(&control.focus)
                    .px_4()
                    .py_2()
                    .rounded_md()
                    .bg(rgb(0xa7edce))
                    .text_color(rgb(0x112b22))
                    .cursor_pointer()
                    .hover(|style| style.bg(rgb(0xc5f5df)))
                    .focus_visible(|style| style.bg(rgb(0xc5f5df)))
                    .child(control.label.clone())
                    .on_click(cx.listener(|demo, _, _, cx| {
                        demo.mod_action_ran = !demo.mod_action_ran;
                        cx.notify();
                    })),
            );
            if self.mod_action_ran {
                content = content.child(control.message.clone());
            }
        }
        content
    }
}

fn main() -> Result<(), poc_ui::LoadError> {
    let patch = std::env::var_os("POC_UI_MOD")
        .map(|path| {
            // The launcher takes an explicit path to a trusted native plugin.
            unsafe { UiPatch::load(Path::new(&path)) }
        })
        .transpose()?;

    gpui_platform::application().run(move |cx: &mut App| {
        cx.on_window_closed(|cx, _| {
            if cx.windows().is_empty() {
                cx.quit();
            }
        })
        .detach();

        let bounds = Bounds::centered(None, size(px(560.), px(290.)), cx);
        let result = cx.open_window(
            WindowOptions {
                window_bounds: Some(WindowBounds::Windowed(bounds)),
                ..Default::default()
            },
            move |window, cx| {
                window.set_window_title("GPUI Mod Demo");
                cx.new(|cx| Demo::new(patch, window, cx))
            },
        );
        match result {
            Ok(_) => cx.activate(true),
            Err(error) => {
                eprintln!("Could not open GPUI demo: {error:#}");
                cx.quit();
            }
        }
    });
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use gpui::{KeyDownEvent, KeyUpEvent, Keystroke, Modifiers, TestAppContext, VisualTestContext};

    #[test]
    fn focused_mod_control_handles_gpui_input() -> Result<(), poc_ui::LoadError> {
        let mut cx = TestAppContext::single();
        let window = cx.open_window(size(px(560.), px(290.)), |window, cx| {
            Demo::new(
                Some(UiPatch {
                    heading: "Replacement heading".into(),
                    button: "Mod control".into(),
                    button_message: "Mod action ran".into(),
                }),
                window,
                cx,
            )
        });
        let mut cx = VisualTestContext::from_window(window.into(), &cx);
        let demo = window.root(&mut cx)?;
        cx.update(|_, _| {});
        assert!(!demo.read_with(&cx, |demo, _| demo.mod_action_ran));

        let enter = Keystroke {
            modifiers: Modifiers::default(),
            key: "enter".into(),
            key_char: None,
        };
        cx.simulate_event(KeyDownEvent {
            keystroke: enter.clone(),
            is_held: false,
            prefer_character_input: false,
        });
        cx.simulate_event(KeyUpEvent { keystroke: enter });
        assert!(demo.read_with(&cx, |demo, _| demo.mod_action_ran));
        Ok(())
    }
}
