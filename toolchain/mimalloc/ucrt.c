/// UCRT's allocator on mimalloc, for a MinGW host's programs, which link
/// mimalloc's object (toolchain/toolchain.ts). mimalloc overrides nothing
/// there itself (mingw-w64's headers define _DLL, for which it leaves the
/// CRT's functions alone): every function of UCRT that allocates, or takes
/// a block, is defined here on mimalloc's. A program's own calls reach
/// these definitions, which come before the import library's: malloc, free
/// and the rest that mingw-w64's headers declare as plain functions, and
/// those they declare dllimport (_CRTIMP: _strdup, _aligned_malloc, ...),
/// whose calls go through __imp_<name>, the address the import fills in,
/// defined here as mingw-w64's own replacements of CRT functions are. None
/// may stay UCRT's: a block of UCRT's heap would reach mimalloc's free
/// (libc++'s locale guard frees what _strdup returned), or one of
/// mimalloc's UCRT's _msize. toolchain.ts checks that no program imports
/// any of them.
///
/// No CRT header: their dllimport declarations would clash with these
/// definitions.

#include <mimalloc.h>

typedef int errno_t;

void *malloc(size_t size) { return mi_malloc(size); }
void *calloc(size_t count, size_t size) { return mi_calloc(count, size); }
void *realloc(void *p, size_t size) { return mi_realloc(p, size); }
void free(void *p) { mi_free(p); }
char *strdup(const char *s) { return mi_strdup(s); }
char *_strdup(const char *s) { return mi_strdup(s); }
wchar_t *_wcsdup(const wchar_t *s) { return mi_wcsdup(s); }
wchar_t *wcsdup(const wchar_t *s) { return mi_wcsdup(s); }
unsigned char *_mbsdup(const unsigned char *s) { return mi_mbsdup(s); }
size_t _msize(void *p) { return mi_usable_size(p); }
void *_expand(void *p, size_t size) { return mi__expand(p, size); }
void *_recalloc(void *p, size_t count, size_t size) { return mi_recalloc(p, count, size); }
void *_aligned_malloc(size_t size, size_t alignment) { return mi_malloc_aligned(size, alignment); }
void *_aligned_realloc(void *p, size_t size, size_t alignment) { return mi_realloc_aligned(p, size, alignment); }
void *_aligned_recalloc(void *p, size_t count, size_t size, size_t alignment) {
  return mi_recalloc_aligned(p, count, size, alignment);
}
void *_aligned_offset_malloc(size_t size, size_t alignment, size_t offset) {
  return mi_malloc_aligned_at(size, alignment, offset);
}
void *_aligned_offset_realloc(void *p, size_t size, size_t alignment, size_t offset) {
  return mi_realloc_aligned_at(p, size, alignment, offset);
}
void *_aligned_offset_recalloc(void *p, size_t count, size_t size, size_t alignment, size_t offset) {
  return mi_recalloc_aligned_at(p, count, size, alignment, offset);
}
size_t _aligned_msize(void *p, size_t alignment, size_t offset) {
  (void)alignment;
  (void)offset;
  return mi_usable_size(p);
}
void _aligned_free(void *p) { mi_free(p); }
errno_t _dupenv_s(char **buffer, size_t *size, const char *name) { return mi_dupenv_s(buffer, size, name); }
errno_t _wdupenv_s(wchar_t **buffer, size_t *size, const wchar_t *name) { return mi_wdupenv_s(buffer, size, name); }

#define IMPORT(name) void *__imp_##name = (void *)&name;
IMPORT(malloc)
IMPORT(calloc)
IMPORT(realloc)
IMPORT(free)
IMPORT(strdup)
IMPORT(_strdup)
IMPORT(_wcsdup)
IMPORT(wcsdup)
IMPORT(_mbsdup)
IMPORT(_msize)
IMPORT(_expand)
IMPORT(_recalloc)
IMPORT(_aligned_malloc)
IMPORT(_aligned_realloc)
IMPORT(_aligned_recalloc)
IMPORT(_aligned_offset_malloc)
IMPORT(_aligned_offset_realloc)
IMPORT(_aligned_offset_recalloc)
IMPORT(_aligned_msize)
IMPORT(_aligned_free)
IMPORT(_dupenv_s)
IMPORT(_wdupenv_s)
