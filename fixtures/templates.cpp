template <typename T>
struct Box {
  T value;
};

int main() {
  Box<int> bi;
  int n;
  int* dyn = new int[n];
  delete[] dyn;
  return 0;
}
