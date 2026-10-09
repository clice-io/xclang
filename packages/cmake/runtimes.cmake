# The C++ runtimes of the build and its sanitizers, for toolchain.cmake,
# which includes this file with XCLANG_ROOT, _xclang_triple (the target),
# _xclang_target_os and _xclang_target_arch set:
#
#   XCLANG_RUNTIMES   prebuilt: the toolchain's libc++, libc++abi and
#                     libunwind (the default); source: those built from the
#                     toolchain's libc++/src with the options below, once
#                     per variant, at the first configure that asks for it,
#                     and every compile and link of the build against them
#                     in place of the prebuilt ones, try_compile's too
#   XCLANG_SANITIZER  the sanitizers of the whole build, a list of address,
#                     memory, thread, undefined and leak: -fsanitize= on its
#                     compiles and links, and runtimes that suit them. With
#                     prebuilt runtimes, address links the prebuilt ASan
#                     libc++ where the target has one, and memory is not
#                     available; with runtimes from source, they are built
#                     with the sanitizers, and with memory, compiler-rt's
#                     MemorySanitizer runtime with them
#
# With XCLANG_RUNTIMES=source only:
#
#   XCLANG_LIBCXX_HARDENING     none, fast, extensive or debug: libc++'s
#                               hardening mode, in the library and the
#                               default of its headers (LIBCXX_HARDENING_MODE)
#   XCLANG_LIBCXX_ABI_VERSION   1 or 2 (LIBCXX_ABI_VERSION)
#   XCLANG_LIBCXX_ABI_NAMESPACE libc++'s inline namespace, __<something>
#                               (LIBCXX_ABI_NAMESPACE)
#   XCLANG_LIBCXX_ABI_DEFINES   a list of libc++'s ABI macros, such as
#                               _LIBCPP_ABI_BOUNDED_ITERATORS (LIBCXX_ABI_DEFINES)
#   XCLANG_RUNTIMES_EXCEPTIONS  OFF: libc++ and libc++abi without exceptions
#   XCLANG_RUNTIMES_RTTI        OFF: libc++ without RTTI (and without
#                               exceptions)
#   XCLANG_RUNTIMES_FLAGS       more compile options of libc++ and libc++abi,
#                               such as -flto=thin, which links their code
#                               with the program's
#   XCLANG_RUNTIMES_CMAKE_ARGS  more arguments of the runtimes' CMake build
#                               (LLVM's runtimes/), -D<var>=<value> each
#   XCLANG_RUNTIMES_DIR         where the variants are built, a directory each;
#                               ${CMAKE_BINARY_DIR}/xclang-runtimes by default
#
# A variant is built as toolchain/runtimes.ts builds the prebuilt runtimes,
# with the same CMake cache (runtimes-cxx.cmake), by this toolchain file
# and the config file of the target: with no options, the same libraries.

# The options a variant is made of, which try_compile projects see as well.
set(_xclang_runtimes_options XCLANG_RUNTIMES XCLANG_SANITIZER XCLANG_LIBCXX_HARDENING XCLANG_LIBCXX_ABI_VERSION
    XCLANG_LIBCXX_ABI_NAMESPACE XCLANG_LIBCXX_ABI_DEFINES XCLANG_RUNTIMES_EXCEPTIONS XCLANG_RUNTIMES_RTTI
    XCLANG_RUNTIMES_FLAGS XCLANG_RUNTIMES_CMAKE_ARGS XCLANG_RUNTIMES_DIR)
list(APPEND CMAKE_TRY_COMPILE_PLATFORM_VARIABLES ${_xclang_runtimes_options})

if(NOT XCLANG_RUNTIMES)
    set(XCLANG_RUNTIMES prebuilt)
endif()
if(NOT XCLANG_RUNTIMES MATCHES "^(prebuilt|source)$")
    message(FATAL_ERROR "xclang: XCLANG_RUNTIMES is ${XCLANG_RUNTIMES}, not prebuilt or source")
endif()
if(NOT XCLANG_RUNTIMES STREQUAL "source")
    foreach(_xclang_option IN LISTS _xclang_runtimes_options)
        if(NOT _xclang_option MATCHES "^XCLANG_(RUNTIMES|SANITIZER)$" AND NOT "${${_xclang_option}}" STREQUAL "")
            message(FATAL_ERROR "xclang: ${_xclang_option} is for runtimes built from source: XCLANG_RUNTIMES=source")
        endif()
    endforeach()
endif()

# XCLANG_SANITIZER, as -fsanitize= takes it and as LLVM_USE_SANITIZER does.
string(REPLACE "," ";" _xclang_sanitizers "${XCLANG_SANITIZER}")
set(_xclang_llvm_sanitizers "")
set(_xclang_names address memory thread undefined leak)
foreach(_xclang_sanitizer IN LISTS _xclang_sanitizers)
    list(FIND _xclang_names "${_xclang_sanitizer}" _xclang_index)
    if(_xclang_index LESS 0)
        message(FATAL_ERROR "xclang: XCLANG_SANITIZER names ${_xclang_sanitizer}, none of ${_xclang_names}")
    endif()
    set(_xclang_llvm Address Memory Thread Undefined Leaks)
    list(GET _xclang_llvm ${_xclang_index} _xclang_llvm)
    list(APPEND _xclang_llvm_sanitizers "${_xclang_llvm}")
endforeach()
list(JOIN _xclang_sanitizers "," _xclang_fsanitize)
set(_xclang_memory OFF)
if(memory IN_LIST _xclang_sanitizers)
    set(_xclang_memory ON)
    if(NOT XCLANG_RUNTIMES STREQUAL "source")
        message(FATAL_ERROR "xclang: MemorySanitizer needs every library instrumented, libc++ too, "
            "and compiler-rt's runtime of it, which the toolchain has not: XCLANG_RUNTIMES=source")
    endif()
endif()

# Options of the directory, and of try_compile projects, which read this file
# again: added once each.
function(_xclang_add kind)
    get_directory_property(present ${kind}_OPTIONS)
    foreach(option IN LISTS ARGN)
        if(NOT option IN_LIST present)
            if(kind STREQUAL "COMPILE")
                add_compile_options("${option}")
            else()
                add_link_options("${option}")
            endif()
        endif()
    endforeach()
endfunction()

# What the target names its directories after: clang's spelling.
if(_xclang_target_os STREQUAL "mingw")
    set(_xclang_normalized "${_xclang_target_arch}-w64-windows-gnu")
else()
    set(_xclang_normalized "${_xclang_triple}")
endif()
if(_xclang_target_os MATCHES "^(linux|musl)$")
    set(_xclang_target_lib "${XCLANG_ROOT}/${_xclang_triple}/usr/lib")
else()
    set(_xclang_target_lib "${XCLANG_ROOT}/${_xclang_triple}/lib")
endif()

if(XCLANG_RUNTIMES STREQUAL "prebuilt")
    if(_xclang_fsanitize)
        _xclang_add(COMPILE "$<$<COMPILE_LANGUAGE:C,CXX,OBJC,OBJCXX>:-fsanitize=${_xclang_fsanitize}>")
        _xclang_add(LINK "-fsanitize=${_xclang_fsanitize}")
    endif()
    # The ASan libc++, whose __config_site comes before the target's; for
    # x64 MSVC it names its library itself.
    if(address IN_LIST _xclang_sanitizers AND EXISTS "${_xclang_target_lib}/asan/include/__config_site")
        _xclang_add(COMPILE "$<$<COMPILE_LANGUAGE:CXX,OBJCXX>:-isystem${_xclang_target_lib}/asan/include>")
        if(EXISTS "${_xclang_target_lib}/asan/libc++.a")
            _xclang_add(LINK -nostdlib++ "${_xclang_target_lib}/asan/libc++.a")
        endif()
    endif()
    return()
endif()

if(_xclang_target_os STREQUAL "msvc")
    message(FATAL_ERROR "xclang: XCLANG_RUNTIMES=source is not available for the MSVC targets yet")
endif()
set(_xclang_sources "${XCLANG_ROOT}/libc++/src")
if(NOT EXISTS "${_xclang_sources}/runtimes/CMakeLists.txt")
    message(FATAL_ERROR "xclang: no runtimes' sources in ${_xclang_sources}: XCLANG_RUNTIMES=source needs a "
        "toolchain that has them, 23.1.2.11 or later")
endif()
if(XCLANG_RUNTIMES_RTTI STREQUAL "OFF" AND NOT XCLANG_RUNTIMES_EXCEPTIONS STREQUAL "OFF")
    message(FATAL_ERROR "xclang: XCLANG_RUNTIMES_RTTI=OFF needs XCLANG_RUNTIMES_EXCEPTIONS=OFF, as libc++ does")
endif()

# The variant: its directory is named after a digest of what it is built
# from and with. The first configure of a build sets XCLANG_RUNTIMES_DIR
# for its try_compile projects, whose binary directory is another.
if(NOT XCLANG_RUNTIMES_DIR)
    set(XCLANG_RUNTIMES_DIR "${CMAKE_BINARY_DIR}/xclang-runtimes")
endif()
file(TO_CMAKE_PATH "${XCLANG_RUNTIMES_DIR}" XCLANG_RUNTIMES_DIR)
set(_xclang_version "")
if(EXISTS "${CMAKE_CURRENT_LIST_DIR}/xclang-config-version.cmake")
    file(SHA256 "${CMAKE_CURRENT_LIST_DIR}/xclang-config-version.cmake" _xclang_version)
endif()
# The SDK of a macOS target from another host is the toolchain file's; on
# macOS, CMake before 4.0 picks one after the toolchain file, so a build's
# first configure would have none and its later ones and try_compile's
# would.
set(_xclang_variant "${_xclang_version}\n${XCLANG_ROOT}\n${_xclang_triple}")
if(NOT CMAKE_HOST_APPLE)
    string(APPEND _xclang_variant "\n${CMAKE_OSX_SYSROOT}")
endif()
foreach(_xclang_option IN LISTS _xclang_runtimes_options)
    if(NOT _xclang_option STREQUAL "XCLANG_RUNTIMES_DIR")
        string(APPEND _xclang_variant "\n${_xclang_option}=${${_xclang_option}}")
    endif()
endforeach()
string(SHA256 _xclang_digest "${_xclang_variant}")
string(SUBSTRING "${_xclang_digest}" 0 12 _xclang_digest)
set(_xclang_dir "${XCLANG_RUNTIMES_DIR}/${_xclang_triple}-${_xclang_digest}")
set(_xclang_install "${_xclang_dir}/install")
set(_xclang_crt "${_xclang_dir}/compiler-rt/lib/${_xclang_normalized}")

# One CMake build of LLVM's runtimes/ into <variant>/install: configured from
# a cache file written here (lists keep their semicolons in it), with this
# toolchain file for the target, and none of the environment's flags.
function(_xclang_build name cache)
    set(build "${_xclang_dir}/${name}")
    file(REMOVE_RECURSE "${build}")
    file(MAKE_DIRECTORY "${build}")
    file(WRITE "${build}.cmake" "${cache}")
    set(args -G "${CMAKE_GENERATOR}" -S "${_xclang_sources}/runtimes" -B "${build}"
        "-DCMAKE_TOOLCHAIN_FILE=${CMAKE_CURRENT_FUNCTION_LIST_DIR}/toolchain.cmake" "-DXCLANG_ROOT=${XCLANG_ROOT}"
        "-DXCLANG_TARGET=${XCLANG_TARGET}" -DXCLANG_RUNTIMES=prebuilt -C "${build}.cmake" ${XCLANG_RUNTIMES_CMAKE_ARGS})
    if(CMAKE_GENERATOR_PLATFORM)
        list(APPEND args -A "${CMAKE_GENERATOR_PLATFORM}")
    endif()
    if(CMAKE_MAKE_PROGRAM)
        list(APPEND args "-DCMAKE_MAKE_PROGRAM=${CMAKE_MAKE_PROGRAM}")
    endif()
    if(CMAKE_OSX_SYSROOT)
        list(APPEND args "-DCMAKE_OSX_SYSROOT=${CMAKE_OSX_SYSROOT}")
    endif()
    set(env "${CMAKE_COMMAND}" -E env --unset=CFLAGS --unset=CXXFLAGS --unset=ASMFLAGS --unset=LDFLAGS)
    foreach(step configure build)
        if(step STREQUAL "configure")
            set(command ${env} "${CMAKE_COMMAND}" ${args})
        else()
            set(command ${env} "${CMAKE_COMMAND}" --build "${build}" --target install --config Release --parallel)
        endif()
        execute_process(COMMAND ${command} OUTPUT_FILE "${build}-${step}.log" ERROR_FILE "${build}-${step}.log"
            RESULT_VARIABLE result)
        if(NOT result EQUAL 0)
            file(STRINGS "${build}-${step}.log" lines)
            list(LENGTH lines count)
            math(EXPR first "${count} - 30")
            if(first LESS 0)
                set(first 0)
            endif()
            list(SUBLIST lines ${first} 30 tail)
            list(JOIN tail "\n" tail)
            message(FATAL_ERROR "xclang: building the runtimes from source failed (${step} of ${build}):\n"
                "${tail}\nThe whole log: ${build}-${step}.log")
        endif()
    endforeach()
endfunction()

if(NOT EXISTS "${_xclang_install}/.xclang-runtimes")
    file(MAKE_DIRECTORY "${_xclang_dir}")
    file(LOCK "${_xclang_dir}.lock" GUARD FILE)
    if(NOT EXISTS "${_xclang_install}/.xclang-runtimes")
        file(REMOVE_RECURSE "${_xclang_install}")
        message(STATUS "xclang: building the C++ runtimes for ${_xclang_triple} from source, once, in ${_xclang_dir}")

        # What every build of runtimes/ here takes: toolchain/runtimes.ts's
        # options, the checks' programs linked against the C runtime and
        # compiler-rt only, no documentation.
        set(common "set(CMAKE_INSTALL_PREFIX \"${_xclang_install}\" CACHE PATH \"\")\n")
        string(APPEND common "set(LLVM_DEFAULT_TARGET_TRIPLE \"${_xclang_normalized}\" CACHE STRING \"\")\n")
        string(APPEND common "set(LLVM_INCLUDE_DOCS OFF CACHE BOOL \"\")\n")
        set(link "--rtlib=compiler-rt --unwindlib=none -nostdlib++")
        if(_xclang_target_os STREQUAL "darwin")
            set(link "-nostdlib++")
        elseif(_xclang_target_os STREQUAL "musl")
            string(APPEND link " -static")
        endif()

        # MemorySanitizer's runtime first, built as toolchain/runtimes.ts
        # builds ASan's and TSan's: the runtimes' checks link it.
        if(_xclang_memory)
            set(cache "${common}")
            # compiler-rt names its directory after the compiler's target.
            foreach(lang C CXX ASM)
                string(APPEND cache "set(CMAKE_${lang}_COMPILER_TARGET \"${_xclang_normalized}\" CACHE STRING \"\")\n")
            endforeach()
            string(APPEND cache "set(COMPILER_RT_INSTALL_PATH \"${_xclang_dir}/compiler-rt\" CACHE PATH \"\")\n")
            string(APPEND cache "set(COMPILER_RT_BUILD_SANITIZERS ON CACHE BOOL \"\")\n")
            string(APPEND cache "set(COMPILER_RT_SANITIZERS_TO_BUILD msan CACHE STRING \"\")\n")
            string(APPEND cache "set(COMPILER_RT_BUILD_PROFILE OFF CACHE BOOL \"\")\n")
            string(APPEND cache "set(SANITIZER_CXX_ABI libc++ CACHE STRING \"\")\n")
            string(APPEND cache "set(SANITIZER_USE_STATIC_CXX_ABI ON CACHE BOOL \"\")\n")
            string(APPEND cache "set(COMPILER_RT_USE_BUILTINS_LIBRARY ON CACHE BOOL \"\")\n")
            string(APPEND cache "include(\"${CMAKE_CURRENT_LIST_DIR}/runtimes-compiler-rt.cmake\")\n")
            _xclang_build(compiler-rt "${cache}")
        endif()

        set(cache "${common}")
        if(_xclang_target_os STREQUAL "darwin")
            # macOS unwinds with the system's libunwind, part of libSystem.
            string(APPEND cache "set(LLVM_ENABLE_RUNTIMES \"libcxxabi;libcxx\" CACHE STRING \"\")\n")
            string(APPEND cache "set(LIBCXXABI_USE_LLVM_UNWINDER OFF CACHE BOOL \"\")\n")
            if(_xclang_llvm_sanitizers)
                # The libraries look for the sanitizers' runtimes next to the
                # builtins, which clang does not report there.
                file(GLOB builtins "${XCLANG_ROOT}/lib/clang/*/lib/darwin/libclang_rt.osx.a")
                string(APPEND cache "set(COMPILER_RT_LIBRARY_builtins_${_xclang_triple} \"${builtins}\" CACHE FILEPATH \"\")\n")
            endif()
        else()
            string(APPEND cache "set(LLVM_ENABLE_RUNTIMES \"libunwind;libcxxabi;libcxx\" CACHE STRING \"\")\n")
            string(APPEND cache "set(LIBCXXABI_USE_LLVM_UNWINDER ON CACHE BOOL \"\")\n")
        endif()
        if(_xclang_target_os STREQUAL "linux")
            # glibc 2.17 predates __cxa_thread_atexit_impl.
            string(APPEND cache "set(LIBCXXABI_HAS_CXA_THREAD_ATEXIT_IMPL OFF CACHE BOOL \"\")\n")
        elseif(_xclang_target_os STREQUAL "musl")
            string(APPEND cache "set(LIBCXX_HAS_MUSL_LIBC ON CACHE BOOL \"\")\n")
        endif()
        # toolchain/runtimes.ts compiles them without the config files, so
        # without -rtlib=compiler-rt, which on arm64 Linux makes clang call
        # compiler-rt's outline atomics (-moutline-atomics); here as there.
        if(_xclang_target_arch STREQUAL "aarch64" AND _xclang_target_os MATCHES "^(linux|musl)$")
            foreach(lang C CXX)
                string(APPEND cache "set(CMAKE_${lang}_FLAGS \"-mno-outline-atomics\" CACHE STRING \"\")\n")
            endforeach()
        endif()
        if(_xclang_llvm_sanitizers)
            string(APPEND cache "set(LLVM_USE_SANITIZER \"${_xclang_llvm_sanitizers}\" CACHE STRING \"\")\n")
        endif()
        if(_xclang_memory)
            # The checks' programs link MemorySanitizer's runtime of the
            # variant, which clang does not find by itself, and the
            # toolchain's libunwind, which it unwinds with.
            string(REPLACE "--unwindlib=none" "" link "${link}")
            string(APPEND link " -fno-sanitize-link-runtime \\\"-Wl,--whole-archive,${_xclang_crt}/libclang_rt.msan.a,"
                "${_xclang_crt}/libclang_rt.msan_cxx.a,--no-whole-archive\\\" -lpthread -lrt -lm -ldl -lresolv")
        endif()
        foreach(pair HARDENING:LIBCXX_HARDENING_MODE ABI_VERSION:LIBCXX_ABI_VERSION ABI_NAMESPACE:LIBCXX_ABI_NAMESPACE
                ABI_DEFINES:LIBCXX_ABI_DEFINES)
            string(REPLACE ":" ";" pair "${pair}")
            list(GET pair 0 ours)
            list(GET pair 1 theirs)
            if(NOT "${XCLANG_LIBCXX_${ours}}" STREQUAL "")
                string(APPEND cache "set(${theirs} \"${XCLANG_LIBCXX_${ours}}\" CACHE STRING \"\")\n")
            endif()
        endforeach()
        if(XCLANG_RUNTIMES_EXCEPTIONS STREQUAL "OFF")
            string(APPEND cache "set(LIBCXX_ENABLE_EXCEPTIONS OFF CACHE BOOL \"\")\n")
            string(APPEND cache "set(LIBCXXABI_ENABLE_EXCEPTIONS OFF CACHE BOOL \"\")\n")
        endif()
        if(XCLANG_RUNTIMES_RTTI STREQUAL "OFF")
            string(APPEND cache "set(LIBCXX_ENABLE_RTTI OFF CACHE BOOL \"\")\n")
        endif()
        # On libc++ and libc++abi, not on libunwind: with -flto, its code in
        # the program's would refer to glibc 2.17's libpthread and libdl
        # (dependent libraries, which lld does not take from bitcode), and
        # the sanitizers' runtimes unwind with it.
        if(XCLANG_RUNTIMES_FLAGS)
            string(REPLACE ";" " " flags "${XCLANG_RUNTIMES_FLAGS}")
            separate_arguments(flags UNIX_COMMAND "${flags}")
            string(APPEND cache "set(LIBCXX_ADDITIONAL_COMPILE_FLAGS \"${flags}\" CACHE STRING \"\")\n")
            string(APPEND cache "set(LIBCXXABI_ADDITIONAL_COMPILE_FLAGS \"${flags}\" CACHE STRING \"\")\n")
        endif()
        string(APPEND cache "set(CMAKE_EXE_LINKER_FLAGS \"${link}\" CACHE STRING \"\")\n")
        # Last: the settings above come first and stand.
        string(APPEND cache "include(\"${CMAKE_CURRENT_LIST_DIR}/runtimes-cxx.cmake\")\n")
        _xclang_build(runtimes "${cache}")
        file(WRITE "${_xclang_dir}/variant.txt" "${_xclang_variant}\n")
        file(WRITE "${_xclang_install}/.xclang-runtimes" "")
    endif()
    file(LOCK "${_xclang_dir}.lock" RELEASE)
endif()

# The build against the variant: its headers in place of the toolchain's
# (-nostdinc++ drops the config file's), and its libraries in place of the
# C++ library and unwinder the driver links (-nostdlib++, --unwindlib=none).
# lld takes archives in any order, so they come with the options.
set(XCLANG_RUNTIMES_INSTALL "${_xclang_install}")
if(_xclang_fsanitize)
    _xclang_add(COMPILE "$<$<COMPILE_LANGUAGE:C,CXX,OBJC,OBJCXX>:-fsanitize=${_xclang_fsanitize}>")
    _xclang_add(LINK "-fsanitize=${_xclang_fsanitize}")
endif()
_xclang_add(COMPILE "$<$<COMPILE_LANGUAGE:CXX,OBJCXX>:-nostdinc++>"
    "$<$<COMPILE_LANGUAGE:CXX,OBJCXX>:-isystem${_xclang_install}/include/c++/v1>")
# With sanitizers, the unwinder stays the toolchain's, uninstrumented, as
# with the prebuilt ASan libc++: the sanitizers' runtimes unwind with it,
# and MemorySanitizer would report the registers it reads.
set(_xclang_libraries "${_xclang_install}/lib/libc++.a" "${_xclang_install}/lib/libc++experimental.a")
if(NOT _xclang_target_os STREQUAL "darwin" AND NOT _xclang_llvm_sanitizers)
    list(APPEND _xclang_libraries "${_xclang_install}/lib/libunwind.a")
    _xclang_add(LINK --unwindlib=none)
endif()
_xclang_add(LINK -nostdlib++ ${_xclang_libraries})
if(_xclang_memory)
    # In executables, as the driver links it: MemorySanitizer's runtime
    # whole (one option, which CMake does not take apart), its interface
    # exported, and the system libraries it calls.
    set(_xclang_exe "$<STREQUAL:$<TARGET_PROPERTY:TYPE>,EXECUTABLE>")
    _xclang_add(LINK -fno-sanitize-link-runtime
        "$<${_xclang_exe}:-Wl,--whole-archive,${_xclang_crt}/libclang_rt.msan.a,${_xclang_crt}/libclang_rt.msan_cxx.a,--no-whole-archive>")
    foreach(_xclang_runtime msan msan_cxx)
        if(EXISTS "${_xclang_crt}/libclang_rt.${_xclang_runtime}.a.syms")
            _xclang_add(LINK "$<${_xclang_exe}:-Wl,--dynamic-list=${_xclang_crt}/libclang_rt.${_xclang_runtime}.a.syms>")
        else()
            _xclang_add(LINK "$<${_xclang_exe}:-Wl,--export-dynamic>")
        endif()
    endforeach()
    _xclang_add(LINK "$<${_xclang_exe}:-Wl,--no-as-needed>" "$<${_xclang_exe}:-lpthread>" "$<${_xclang_exe}:-lrt>"
        "$<${_xclang_exe}:-lm>" "$<${_xclang_exe}:-ldl>" "$<${_xclang_exe}:-lresolv>")
endif()
