use std::ffi::{CStr, c_char, c_int};

unsafe extern "C" {
    fn hello(buffer: *mut c_char, size: c_int) -> c_int;
}

fn main() {
    let mut buffer = [0 as c_char; 64];
    let text = unsafe {
        hello(buffer.as_mut_ptr(), buffer.len() as c_int);
        CStr::from_ptr(buffer.as_ptr())
    };
    println!("{}, linked by xclang", text.to_string_lossy());
}
