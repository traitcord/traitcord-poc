// SPDX-License-Identifier: GPL-3.0-only

//! Launch a cooperative GPUI host or inject the native AppKit loader.

use std::io;
use std::path::Path;
use std::process::{Command, ExitCode, ExitStatus};

fn main() -> ExitCode {
    match launch() {
        Ok(status) => ExitCode::from(status.code().map_or(1, |code| code as u8)),
        Err(error) => {
            eprintln!("poc_injector: {error}");
            ExitCode::FAILURE
        }
    }
}

fn launch() -> io::Result<ExitStatus> {
    let mut arguments = std::env::args_os().skip(1);
    let usage = "usage: poc_injector [--ui] <app-binary> <mod-library> [app args...]";
    let target = arguments.next().ok_or_else(|| io::Error::other(usage))?;
    let cooperative = target == "--ui";
    let target = if cooperative {
        arguments.next().ok_or_else(|| io::Error::other(usage))?
    } else {
        target
    };
    let plugin = arguments.next().ok_or_else(|| io::Error::other(usage))?;
    let target = checked_file(Path::new(&target))?;
    let plugin = checked_file(Path::new(&plugin))?;
    let mut command = Command::new(target);
    command.args(arguments);

    if cooperative {
        return command.env("POC_UI_MOD", plugin).status();
    }
    if !cfg!(target_os = "macos") {
        return Err(io::Error::other(
            "native injection requires macOS; use --ui with a cooperative host",
        ));
    }
    let executable = std::env::current_exe()?;
    let directory = executable
        .parent()
        .ok_or_else(|| io::Error::other("launcher has no parent directory"))?;
    let loader = checked_file(&directory.join("libpoc_loader.dylib"))?;
    command
        .env("DYLD_INSERT_LIBRARIES", loader)
        .env("POC_MOD", plugin)
        .status()
}

fn checked_file(path: &Path) -> io::Result<std::path::PathBuf> {
    match path.canonicalize() {
        Ok(path) if path.is_file() => Ok(path),
        Ok(_) => Err(io::Error::other(format!("not a file: {}", path.display()))),
        Err(error) => Err(io::Error::new(
            error.kind(),
            format!("{}: {error}", path.display()),
        )),
    }
}
