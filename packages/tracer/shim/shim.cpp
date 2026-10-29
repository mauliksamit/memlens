// MemLens allocator shim — LD_PRELOAD / DYLD_INSERT_LIBRARIES.
//
// Interposes malloc/calloc/realloc/free and C++ new/delete, emitting one
// NDJSON MemoryEvent per line to $MEMLENS_TRACE_OUT (fd opened once).
// Call stacks are captured with backtrace() and resolved offline with
// addr2line (see TraceRunner) to keep the fast path allocation-safe-ish.
//
// Build: g++ -shared -fPIC -o libmemlens_shim.so shim.cpp -ldl -rdynamic
// Usage: MEMLENS_TRACE_OUT=/tmp/ev.ndjson LD_PRELOAD=./libmemlens_shim.so ./app
#define _GNU_SOURCE
#include <dlfcn.h>
#include <unistd.h>
#include <fcntl.h>
#include <stdlib.h>
#include <string.h>
#include <stdio.h>
#include <execinfo.h>
#include <pthread.h>
#include <malloc.h>

static int g_out_fd = -1;
static unsigned long g_seq = 0;
static pthread_mutex_t g_lock = PTHREAD_MUTEX_INITIALIZER;
static __thread int g_in_hook = 0;

typedef void* (*malloc_fn)(size_t);
typedef void  (*free_fn)(void*);
typedef void* (*calloc_fn)(size_t, size_t);
typedef void* (*realloc_fn)(void*, size_t);

static void ensure_open(void) {
    if (g_out_fd >= 0) return;
    const char* path = getenv("MEMLENS_TRACE_OUT");
    if (!path) return;
    g_out_fd = open(path, O_WRONLY | O_CREAT | O_TRUNC, 0644);
    const char* s = getenv("MEMLENS_SEQ_START");
    if (s) g_seq = strtoul(s, NULL, 10);
}

static void emit(const char* kind, void* addr, size_t size) {
    if (g_in_hook) return;
    g_in_hook = 1;
    ensure_open();
    if (g_out_fd >= 0) {
        void* bt[16];
        int n = backtrace(bt, 16);
        char* comma = (char*)"";
        char buf[4096];
        int off = snprintf(buf, sizeof(buf),
            "{\"seq\":%lu,\"kind\":\"%s\",\"addr\":\"%p\",\"size\":%zu,"
            "\"thread\":\"%lu\",\"stack\":[",
            g_seq++, kind, addr, size, (unsigned long)pthread_self());
        for (int i = 0; i < n && off < (int)sizeof(buf) - 128; i++) {
            off += snprintf(buf + off, sizeof(buf) - off,
                "%s{\"function\":\"%p\",\"file\":\"?\",\"line\":0}",
                comma, bt[i]);
            comma = (char*)",";
        }
        off += snprintf(buf + (off < (int)sizeof(buf) ? off : sizeof(buf) - 1),
                         sizeof(buf) - (off < (int)sizeof(buf) ? off : sizeof(buf) - 1),
                         "],\"timestamp\":0}\n");
        pthread_mutex_lock(&g_lock);
        ssize_t w = write(g_out_fd, buf, strlen(buf));
        (void)w;
        pthread_mutex_unlock(&g_lock);
    }
    g_in_hook = 0;
}

extern "C" {

void* malloc(size_t size) {
    static malloc_fn real_malloc = NULL;
    if (!real_malloc) real_malloc = (malloc_fn)dlsym(RTLD_NEXT, "malloc");
    void* p = real_malloc(size);
    if (p) emit("alloc", p, size);
    return p;
}

void free(void* ptr) {
    static free_fn real_free = NULL;
    if (!real_free) real_free = (free_fn)dlsym(RTLD_NEXT, "free");
    if (ptr) emit("free", ptr, 0);
    real_free(ptr);
}

void* calloc(size_t n, size_t size) {
    static calloc_fn real_calloc = NULL;
    if (!real_calloc) real_calloc = (calloc_fn)dlsym(RTLD_NEXT, "calloc");
    void* p = real_calloc(n, size);
    if (p) emit("alloc", p, n * size);
    return p;
}

void* realloc(void* ptr, size_t size) {
    static realloc_fn real_realloc = NULL;
    if (!real_realloc) real_realloc = (realloc_fn)dlsym(RTLD_NEXT, "realloc");
    void* p = real_realloc(ptr, size);
    emit("realloc", p ? p : ptr, size);
    return p;
}

void* _Znwm(unsigned long size) { return malloc(size); }        // operator new
void  _ZdlPv(void* ptr) { free(ptr); }                          // operator delete
void* _Znam(unsigned long size) { return malloc(size); }        // operator new[]
void  _ZdaPv(void* ptr) { free(ptr); }                          // operator delete[]

} // extern "C"
