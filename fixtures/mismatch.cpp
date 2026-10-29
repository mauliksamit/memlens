int main() {
  int* a = new int[5];
  delete a;
  int* b = new int(1);
  delete[] b;
  return 0;
}
