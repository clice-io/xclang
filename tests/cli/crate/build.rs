use std::env;
use std::path::PathBuf;

fn main() {
    // C, and C++ (exceptions, the C++ library), with the cc crate.
    cc::Build::new().file("src/probe.c").compile("probe_c");
    cc::Build::new()
        .cpp(true)
        .std("c++20")
        .file("src/probe.cpp")
        .compile("probe_cpp");
    // A CMake project, with the cmake crate.
    let cmake = cmake::build("cmake");
    println!("cargo:rustc-link-search=native={}", cmake.join("lib").display());
    println!("cargo:rustc-link-lib=static=probe_cmake");
    // Rust's view of a C struct, by bindgen, for the target.
    let out = PathBuf::from(env::var("OUT_DIR").unwrap());
    bindgen::Builder::default()
        .header("src/probe.h")
        .allowlist_type("probe")
        .allowlist_function("probe_.*")
        .generate()
        .expect("bindgen")
        .write_to_file(out.join("probe.rs"))
        .unwrap();
}
