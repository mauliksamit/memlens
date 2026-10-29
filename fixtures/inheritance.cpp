struct Base {
  int x;
  virtual ~Base() {}
};

struct Derived : public Base {
  double y;
  char tag;
};

int main() {
  Derived d;
  Base* b = new Derived();
  delete b;
  return 0;
}
