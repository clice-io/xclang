# musl's patches

musl 1.2.6 is the release the musl targets are built from
(`toolchain/sysroot.ts`), with the patches of musl's security advisories
against it, which [musl.libc.org](https://musl.libc.org) asks users of
1.2.6 to apply. Each is a commit of musl's git as
`https://git.musl-libc.org/cgit/musl/patch/?id=<commit>` gives it, applied
in order of its name, without fuzz.

| patch | commit | advisory |
|---|---|---|
| 0001-iconv-gb18030-CVE-2026-6042.patch | 67219f0130ec7c876ac0b299046460fad31caabf | [CVE-2026-6042](https://www.openwall.com/lists/musl/2026/04/03/2): iconv's GB18030 decoder, slow enough for a denial of service |
| 0002-qsort-pntz-CVE-2026-40200.patch | 228da39e38c1cae13cbe637e771412c1984dba5d | [CVE-2026-40200](https://www.openwall.com/lists/musl/2026/04/10/3): qsort's stack corruption, on 32-bit targets |
| 0003-qsort-mask-indices.patch | b3291b9a9f77f1f993d2b4f8c68a26cf09221ae7 | the same advisory: qsort's indices kept in range whatever the input |
| 0004-qsort-shift-ub.patch | 5122f9f3c99fee366167c5de98b31546312921ab | the same advisory: a shift by the word size in qsort |

The next musl release has them all; it replaces 1.2.6 and this directory
empties.
