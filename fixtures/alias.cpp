int main() {
  int* a = new int[5];
  int* b = new int(1);
  b = a;
  delete[] b;

  return 0;


}






