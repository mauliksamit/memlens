// MemLens layout ground-truth probes.
// Compiled by a REAL compiler (g++/clang++/cl); prints sizeof/alignof/offsetof
// as JSON to stdout. This file is the oracle — MemLens output is tested against it.
// C++17 minimum (C++20 for [[no_unique_address]]; guarded).
#include <cstddef>
#include <cstdint>
#include <cstdio>
#include <string>
#include <vector>
#include <memory>
#include <map>

#define OUT(...) std::printf(__VA_ARGS__)

// ---- padding / reordering traps ----
struct P_Plain { int a; char b; };
struct P_Reordered { char a; double d; char b; };
struct P_ReorderedOpt { double d; char a; char b; };

// ---- alignas ----
struct P_AlignAs { alignas(16) char c; int x; };

// ---- #pragma pack ----
#if defined(_MSC_VER)
#pragma pack(push, 1)
struct P_Packed { char a; int b; double c; };
#pragma pack(pop)
#else
struct __attribute__((packed)) P_Packed { char a; int b; double c; };
#endif

// ---- bitfields (sizeof/align only; offsetof is ill-formed on bit-fields) ----
struct P_Bits { unsigned a : 3; unsigned b : 5; unsigned c : 24; };

// ---- empty base optimisation ----
struct P_Empty {};
struct P_Ebo : P_Empty { int x; };
struct P_NoEbo { P_Empty e; int x; };

// ---- inheritance / vptr ----
struct P_Base { int x; };
struct P_Single : P_Base { double y; char tag; };
struct P_B1 { int a; };
struct P_B2 { double b; };
struct P_Multi : P_B1, P_B2 { char c; };
struct P_Virt { int x; virtual ~P_Virt() {} };
struct P_VBase { int v; };
struct P_Virtual : virtual P_VBase { int y; };

// ---- union ----
union P_Union { int i; double d; char s[16]; };

// ---- [[no_unique_address]] (C++20) ----
#if __cplusplus >= 202002L || (defined(_MSC_VER) && _MSC_VER >= 1929)
struct P_Nouaddr { [[no_unique_address]] P_Empty e; int x; };
#define HAVE_NOUADDR 1
#else
struct P_Nouaddr { P_Empty e; int x; };
#define HAVE_NOUADDR 0
#endif

// ---- nested aggregate ----
struct P_Nested { struct Inner { int a; char b; }; Inner in; double d; };

// ---- ABI fundamentals ----
struct P_Fund {};
using IntIntMap = std::map<int, int>;

int main() {
  OUT("{\n");
  OUT("\"abi\":{\"pointer\":%zu,\"long\":%zu,\"long_double\":%zu,\"have_no_unique_address\":%d,\n",
      sizeof(void*), sizeof(long), sizeof(long double), HAVE_NOUADDR);
#if defined(_GLIBCXX_RELEASE)
  OUT("\"stdlib\":\"libstdc++ %d\",\n", _GLIBCXX_RELEASE);
#elif defined(_LIBCPP_VERSION)
  OUT("\"stdlib\":\"libc++ %d\",\n", _LIBCPP_VERSION);
#elif defined(_MSC_VER)
  OUT("\"stdlib\":\"MSVC %d\",\n", _MSC_VER);
#else
  OUT("\"stdlib\":\"unknown\",\n");
#endif
#if defined(_MSC_VER)
  OUT("\"compiler\":\"msvc\"},\n");
#elif defined(__clang__)
  OUT("\"compiler\":\"clang %d.%d.%d\"},\n", __clang_major__, __clang_minor__, __clang_patchlevel__);
#elif defined(__GNUC__)
  OUT("\"compiler\":\"gcc %d.%d.%d\"},\n", __GNUC__, __GNUC_MINOR__, __GNUC_PATCHLEVEL__);
#else
  OUT("\"compiler\":\"unknown\"},\n");
#endif

#define PROBE_BEGIN(T) OUT("\"" #T "\":{\"sizeof\":%zu,\"align\":%zu", sizeof(T), alignof(T))
#define FIELD(S, F) OUT(",\"%s\":{\"offset\":%zu,\"size\":%zu}", #F, offsetof(S, F), sizeof(((S*)0)->F))
#define PROBE_END() OUT("},\n")

  PROBE_BEGIN(P_Plain); FIELD(P_Plain, a); FIELD(P_Plain, b); PROBE_END();
  PROBE_BEGIN(P_Reordered); FIELD(P_Reordered, a); FIELD(P_Reordered, d); FIELD(P_Reordered, b); PROBE_END();
  PROBE_BEGIN(P_ReorderedOpt); FIELD(P_ReorderedOpt, d); FIELD(P_ReorderedOpt, a); FIELD(P_ReorderedOpt, b); PROBE_END();
  PROBE_BEGIN(P_AlignAs); FIELD(P_AlignAs, c); FIELD(P_AlignAs, x); PROBE_END();
  PROBE_BEGIN(P_Packed); FIELD(P_Packed, a); FIELD(P_Packed, b); FIELD(P_Packed, c); PROBE_END();
  // bitfields: no offsets (ill-formed); sizes of underlying storage via sizeof only
  OUT("\"P_Bits\":{\"sizeof\":%zu,\"align\":%zu},\n", sizeof(P_Bits), alignof(P_Bits));
  PROBE_BEGIN(P_Empty); PROBE_END();
  PROBE_BEGIN(P_Ebo); FIELD(P_Ebo, x); PROBE_END();
  PROBE_BEGIN(P_NoEbo); FIELD(P_NoEbo, e); FIELD(P_NoEbo, x); PROBE_END();
  PROBE_BEGIN(P_Base); FIELD(P_Base, x); PROBE_END();
  PROBE_BEGIN(P_Single); FIELD(P_Single, y); FIELD(P_Single, tag); PROBE_END();
  PROBE_BEGIN(P_B1); FIELD(P_B1, a); PROBE_END();
  PROBE_BEGIN(P_B2); FIELD(P_B2, b); PROBE_END();
  PROBE_BEGIN(P_Multi); FIELD(P_Multi, c); PROBE_END();
  PROBE_BEGIN(P_Virt); FIELD(P_Virt, x); PROBE_END();
  PROBE_BEGIN(P_VBase); FIELD(P_VBase, v); PROBE_END();
  PROBE_BEGIN(P_Virtual); FIELD(P_Virtual, y); PROBE_END();
  PROBE_BEGIN(P_Union); FIELD(P_Union, i); FIELD(P_Union, d); FIELD(P_Union, s); PROBE_END();
  PROBE_BEGIN(P_Nouaddr); FIELD(P_Nouaddr, x); PROBE_END();
  PROBE_BEGIN(P_Nested); FIELD(P_Nested, in); FIELD(P_Nested, d); PROBE_END();

  // standard containers: object size only (implementation-defined; stdlib recorded above)
#define STDPROBE(T, KEY) OUT("\"" KEY "\":{\"sizeof\":%zu,\"align\":%zu},\n", sizeof(T), alignof(T))
  STDPROBE(std::string, "std::string");
  STDPROBE(std::vector<int>, "std::vector<int>");
  STDPROBE(std::unique_ptr<int>, "std::unique_ptr<int>");
  STDPROBE(std::shared_ptr<int>, "std::shared_ptr<int>");
  STDPROBE(IntIntMap, "std::map<int,int>");
  OUT("\"P_Fund\":{\"sizeof\":0,\"align\":1}\n");
  OUT("}\n");
  return 0;
}
