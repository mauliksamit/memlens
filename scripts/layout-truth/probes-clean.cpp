// Clean declarations mirroring scripts/layout-truth/probes.cpp, for the MemLens
// parse → layout path (no macros, no probe scaffolding). Oracle values live in
// fixtures/truth/*.json (produced by real compilers, NOT MemLens).
struct P_Plain { int a; char b; };
struct P_Reordered { char a; double d; char b; };
struct P_ReorderedOpt { double d; char a; char b; };
struct P_AlignAs { alignas(16) char c; int x; };
struct __attribute__((packed)) P_Packed { char a; int b; double c; };
struct P_Bits { unsigned a : 3; unsigned b : 5; unsigned c : 24; };
struct P_Empty {};
struct P_Ebo : P_Empty { int x; };
struct P_NoEbo { P_Empty e; int x; };
struct P_Base { int x; };
struct P_Single : P_Base { double y; char tag; };
struct P_B1 { int a; };
struct P_B2 { double b; };
struct P_Multi : P_B1, P_B2 { char c; };
struct P_Virt { int x; virtual ~P_Virt() {} };
struct P_VBase { int v; };
struct P_Virtual : virtual P_VBase { int y; };
union P_Union { int i; double d; char s[16]; };
struct P_Nouaddr { [[no_unique_address]] P_Empty e; int x; };
struct P_Nested { struct Inner { int a; char b; }; Inner in; double d; };

int main() {
  P_Plain plain;
  P_Union u;
  return 0;
}
