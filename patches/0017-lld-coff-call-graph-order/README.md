# lld-link lays out a program the same way on every link

lld-link orders a program's functions by the call graph profile that PGO
leaves in every object (`.llvm.call-graph-profile`, sorted by default):
it computes an order for each section, then records it under the name of
the section's symbol (`Writer::sortSections`, lld/COFF/Writer.cpp),
walking a map keyed by the sections' addresses in memory. Local functions
of different objects can have the same name, a `static` function or an
instantiation for a type in an anonymous namespace, and that name then
gets the order of whichever of its sections the walk visits last, which
changes with the heap's addresses: the same objects link to another
layout on each run. Every section of the name goes there.

Linked twice from one build, xclang's Windows `llvm.exe` had three such
names in other places (copies of `growAndPushBack` for an anonymous
namespace's type, AArch64's `encodeLogicalImmediate`), which moved 22274
of its 165517 functions; clice's `clice.exe`, linked six times, came out
in three layouts. MinGW and MSVC targets alike; ld.lld and ld64.lld sort
by section, not by name.

The patch gives a name the lowest order of its sections, whatever the
order of the walk.

- Upstream: not reported.
- Checked: applies to 23.1.2 with `patch -F0`; the patched Writer.cpp
  compiles against 23.1.2's headers. 24 objects, each with a `static hot`
  that its `f<i>` calls (`.cg_profile`), linked 12 times by LLD 22.1.5 or
  xclang's 23.1.2 lld-link, in MinGW mode or not: 6 to 11 different
  programs; with `/call-graph-profile-sort:no`, one. The smoke test links them 12 times
  on every host and wants one program.
