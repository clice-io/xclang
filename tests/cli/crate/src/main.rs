//! C, C++, a CMake project and bindgen's bindings, built for a target by
//! `xclang cargo` (tests/cli/cargo.ts), with RUSTFLAGS of the user's.

use std::ffi::{CStr, c_char, c_int};

#[allow(non_camel_case_types, non_snake_case, non_upper_case_globals, dead_code)]
mod bindings {
    include!(concat!(env!("OUT_DIR"), "/probe.rs"));
}
use bindings::{probe, probe_c, probe_size};

unsafe extern "C" {
    fn probe_cpp(buffer: *mut c_char, size: c_int) -> c_int;
    fn probe_cmake() -> c_int;
}

fn text(f: unsafe extern "C" fn(*mut c_char, c_int) -> c_int) -> String {
    let mut buffer = [0 as c_char; 64];
    unsafe {
        f(buffer.as_mut_ptr(), buffer.len() as c_int);
        CStr::from_ptr(buffer.as_ptr()).to_string_lossy().into_owned()
    }
}

/// What the program prints, or what is wrong.
fn probe() -> Result<String, String> {
    if !cfg!(xclang_probe) {
        return Err("RUSTFLAGS did not reach rustc".into());
    }
    let (rust, c) = (size_of::<probe>(), unsafe { probe_size() });
    if rust != c {
        return Err(format!("struct probe: {rust} bytes to bindgen, {c} to C"));
    }
    let cmake = unsafe { probe_cmake() };
    Ok(format!("{}, {}, CMake {cmake}, bindgen: linked by xclang", text(probe_c), text(probe_cpp)))
}

fn main() {
    match probe() {
        Ok(line) => println!("{line}"),
        Err(e) => {
            eprintln!("error: {e}");
            std::process::exit(1);
        }
    }
}

#[test]
fn probes() {
    assert_eq!(probe().unwrap(), include_str!("../expected.txt").trim_end());
}
