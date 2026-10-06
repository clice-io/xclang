# One host's toolchain and libclang, from one build. toolchain/toolchain.ts
# adds the host triple, the profile and the cross-compiling settings; the
# compiler is an xclang tree (toolchain/cmake/toolchain.cmake), whose
# config file links xclang's own libc++, statically.
#
# Two distributions come out of it:
#   Toolchain    clang, lld and the binary tools    install-toolchain-distribution-stripped
#   Development  libclang: libraries and headers    install-development-distribution

set(CMAKE_BUILD_TYPE Release CACHE STRING "")
set(CMAKE_C_FLAGS_RELEASE "-O3 -DNDEBUG -gline-tables-only" CACHE STRING "")
set(CMAKE_CXX_FLAGS_RELEASE "-O3 -DNDEBUG -gline-tables-only" CACHE STRING "")

set(LLVM_ENABLE_PROJECTS "clang;clang-tools-extra;lld" CACHE STRING "")
set(LLVM_TARGETS_TO_BUILD all CACHE STRING "")
set(LLVM_ENABLE_ASSERTIONS OFF CACHE BOOL "")
set(LLVM_ENABLE_LTO Thin CACHE STRING "")
set(LLVM_PARALLEL_LINK_JOBS 1 CACHE STRING "")
set(LLVM_ENABLE_LIBCXX ON CACHE BOOL "")
set(LLVM_STATIC_LINK_CXX_STDLIB ON CACHE BOOL "")

# Static zlib and zstd (toolchain/toolchain.ts builds them and names them):
# compressed debug sections and profiles, in lld, clang and the tools.
set(LLVM_ENABLE_ZLIB FORCE_ON CACHE STRING "")
set(LLVM_ENABLE_ZSTD FORCE_ON CACHE STRING "")
set(LLVM_USE_STATIC_ZSTD ON CACHE BOOL "")
set(LLVM_ENABLE_LIBXML2 OFF CACHE BOOL "")
set(LLVM_ENABLE_LIBEDIT OFF CACHE BOOL "")
set(LLVM_ENABLE_LIBPFM OFF CACHE BOOL "")
set(LLVM_ENABLE_Z3_SOLVER OFF CACHE BOOL "")
set(LLVM_ENABLE_CURL OFF CACHE BOOL "")
set(LLVM_ENABLE_HTTPLIB OFF CACHE BOOL "")
set(LLVM_ENABLE_DIA_SDK OFF CACHE BOOL "")
set(LLVM_ENABLE_BINDINGS OFF CACHE BOOL "")
set(LLVM_ENABLE_OCAMLDOC OFF CACHE BOOL "")
set(LLVM_ENABLE_PLUGINS OFF CACHE BOOL "")
set(LLVM_BUILD_LLVM_DYLIB OFF CACHE BOOL "")
set(LLVM_LINK_LLVM_DYLIB OFF CACHE BOOL "")
set(LLVM_INCLUDE_TESTS OFF CACHE BOOL "")
set(LLVM_INCLUDE_EXAMPLES OFF CACHE BOOL "")
set(LLVM_INCLUDE_BENCHMARKS OFF CACHE BOOL "")
set(LLVM_INCLUDE_DOCS OFF CACHE BOOL "")

# No CLANG_DEFAULT_CXX_STDLIB, _RTLIB, _UNWINDLIB or _LINKER: the config
# files (toolchain/config/*.cfg) choose xclang's runtimes and lld. Defaults
# built in would reach libclang's driver as well, which clice runs to stand
# in for other compilers: a g++ command then got libc++'s headers.
set(CLANG_DEFAULT_OBJCOPY llvm-objcopy CACHE STRING "")
set(CLANG_LINK_CLANG_DYLIB OFF CACHE BOOL "")
set(CLANG_PLUGIN_SUPPORT OFF CACHE BOOL "")
set(CLANG_ENABLE_CLANGD OFF CACHE BOOL "")
set(CLANG_INCLUDE_TESTS OFF CACHE BOOL "")
set(CLANG_INCLUDE_DOCS OFF CACHE BOOL "")
# clice builds its clang-tidy without both.
set(CLANG_TIDY_ENABLE_STATIC_ANALYZER OFF CACHE BOOL "")
set(CLANG_TIDY_ENABLE_QUERY_BASED_CUSTOM_CHECKS OFF CACHE BOOL "")

set(LLVM_DISTRIBUTIONS "Toolchain;Development" CACHE STRING "")
# FileCheck, for the lit tests of projects built with xclang (catter):
# utilities have install targets only with this.
set(LLVM_INSTALL_UTILS ON CACHE BOOL "")

# One program, llvm, is clang, lld and every tool that can be built into
# it; their names are links to it (on Windows, small programs that start
# it: toolchain/toolchain.ts). The tools share most of LLVM, which each one
# would otherwise carry in full.
set(LLVM_TOOL_LLVM_DRIVER_BUILD ON CACHE BOOL "")

set(LLVM_Toolchain_DISTRIBUTION_COMPONENTS
    llvm-driver
    clang
    clang-resource-headers
    clang-scan-deps
    lld
    llvm-ar llvm-ranlib llvm-lib llvm-dlltool
    llvm-nm llvm-size llvm-strings llvm-cxxfilt
    llvm-objcopy llvm-strip llvm-install-name-tool llvm-bitcode-strip
    llvm-objdump llvm-otool
    llvm-readobj llvm-readelf
    llvm-rc llvm-windres
    llvm-profdata llvm-cov
    llvm-symbolizer llvm-addr2line
    llvm-dwarfdump
    # A program's debug symbols for its release: dSYM bundles of Mach-O
    # programs, and GSYM, a compact address-to-function-and-line table,
    # from the DWARF of any. (llvm-driver installs every name of llvm, so
    # they were there already; named for what they are for.)
    dsymutil llvm-gsymutil
    llvm-libtool-darwin llvm-lipo
    FileCheck
    CACHE STRING "")

# What a tool built on clang links, clice's closure: the clang, clang-tidy
# and LLVM libraries below, every target's MC layer (TargetInfo, MC
# descriptions, assembly parser and disassembler: a tool registers them to
# look a target up by triple, and clang parses MS-style __asm {} through
# X86's), headers and CMake exports. No target's code generator: the
# headers name those of every target, for InitializeAllTargets and
# InitializeAllAsmPrinters, which do not link.
set(LLVM_Development_DISTRIBUTION_COMPONENTS
    clangAPINotes clangAST clangASTMatchers clangAnalysis
    clangAnalysisFlowSensitive clangAnalysisFlowSensitiveModels
    clangAnalysisLifetimeSafety clangBasic clangDependencyScanning clangDriver
    clangEdit clangFormat clangFrontend clangIncludeCleaner clangIndex clangLex
    clangOptions clangParse clangRewrite
    clangScalableStaticAnalysisAnalyses clangScalableStaticAnalysisCore
    clangScalableStaticAnalysisFrontend
    clangScalableStaticAnalysisSourceTransformation
    clangSema clangSerialization clangSupport
    clangTidy clangTidyAbseilModule clangTidyAlteraModule clangTidyAndroidModule
    clangTidyBoostModule clangTidyBugproneModule clangTidyCERTModule
    clangTidyConcurrencyModule clangTidyCppCoreGuidelinesModule
    clangTidyDarwinModule clangTidyFuchsiaModule clangTidyGoogleModule
    clangTidyLLVMLibcModule clangTidyLLVMModule clangTidyLinuxKernelModule
    clangTidyMiscModule clangTidyModernizeModule clangTidyObjCModule
    clangTidyOpenMPModule clangTidyPerformanceModule clangTidyPortabilityModule
    clangTidyReadabilityModule clangTidyUtils clangTidyZirconModule
    clangTooling clangToolingCore clangToolingInclusions
    clangToolingInclusionsStdlib clangToolingRefactoring clangToolingSyntax
    clangTransformer clangUnifiedSymbolResolution
    LLVMAggressiveInstCombine LLVMAnalysis LLVMAsmParser LLVMBinaryFormat
    LLVMBitReader LLVMBitstreamReader LLVMCore LLVMDebugInfoBTF
    LLVMDebugInfoCodeView LLVMDebugInfoDWARF LLVMDebugInfoDWARFLowLevel
    LLVMDebugInfoGSYM LLVMDebugInfoMSF LLVMDebugInfoPDB LLVMDemangle
    LLVMFrontendAtomic LLVMFrontendDirective LLVMFrontendHLSL
    LLVMFrontendOffloading LLVMFrontendOpenMP LLVMIRReader LLVMInstCombine
    LLVMMC LLVMMCParser LLVMObject LLVMObjectYAML LLVMOption LLVMPlugins
    LLVMProfileData LLVMRemarks LLVMScalarOpts LLVMSupport LLVMSymbolize
    LLVMTargetParser LLVMTextAPI LLVMTransformUtils LLVMWindowsDriver
    LLVMCodeGenTypes LLVMMCDisassembler
    # Every target's MC layer, with the Utils libraries AArch64's, AMDGPU's
    # and ARM's use.
    LLVMAArch64Info LLVMAArch64Desc LLVMAArch64AsmParser
    LLVMAArch64Disassembler LLVMAArch64Utils LLVMAMDGPUInfo LLVMAMDGPUDesc
    LLVMAMDGPUAsmParser LLVMAMDGPUDisassembler LLVMAMDGPUUtils LLVMARMInfo
    LLVMARMDesc LLVMARMAsmParser LLVMARMDisassembler LLVMARMUtils LLVMAVRInfo
    LLVMAVRDesc LLVMAVRAsmParser LLVMAVRDisassembler LLVMBPFInfo LLVMBPFDesc
    LLVMBPFAsmParser LLVMBPFDisassembler LLVMHexagonInfo LLVMHexagonDesc
    LLVMHexagonAsmParser LLVMHexagonDisassembler LLVMLanaiInfo LLVMLanaiDesc
    LLVMLanaiAsmParser LLVMLanaiDisassembler LLVMLoongArchInfo
    LLVMLoongArchDesc LLVMLoongArchAsmParser LLVMLoongArchDisassembler
    LLVMMipsInfo LLVMMipsDesc LLVMMipsAsmParser LLVMMipsDisassembler
    LLVMMSP430Info LLVMMSP430Desc LLVMMSP430AsmParser LLVMMSP430Disassembler
    LLVMNVPTXInfo LLVMNVPTXDesc LLVMPowerPCInfo LLVMPowerPCDesc
    LLVMPowerPCAsmParser LLVMPowerPCDisassembler LLVMRISCVInfo LLVMRISCVDesc
    LLVMRISCVAsmParser LLVMRISCVDisassembler LLVMSparcInfo LLVMSparcDesc
    LLVMSparcAsmParser LLVMSparcDisassembler LLVMSPIRVInfo LLVMSPIRVDesc
    LLVMSystemZInfo LLVMSystemZDesc LLVMSystemZAsmParser
    LLVMSystemZDisassembler LLVMVEInfo LLVMVEDesc LLVMVEAsmParser
    LLVMVEDisassembler LLVMWebAssemblyInfo LLVMWebAssemblyDesc
    LLVMWebAssemblyAsmParser LLVMWebAssemblyDisassembler LLVMX86Info
    LLVMX86Desc LLVMX86AsmParser LLVMX86Disassembler LLVMXCoreInfo
    LLVMXCoreDesc LLVMXCoreDisassembler
    llvm-headers clang-headers clang-tidy-headers clang-resource-headers
    development-cmake-exports clang-development-cmake-exports
    # LLVMConfig.cmake and ClangConfig.cmake, with the modules they load
    # (Findzstd.cmake, AddLLVM.cmake, ...): what find_package reads.
    cmake-exports clang-cmake-exports
    CACHE STRING "")
