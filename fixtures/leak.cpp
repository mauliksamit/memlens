int main() {
  int* leak = new int(42);
  int* ok = new int(1);
  delete ok;
  return 0;
}
