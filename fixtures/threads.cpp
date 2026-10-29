#include <thread>

void worker(int n) {
  int* buf = new int[n];
  delete[] buf;
}

int main() {
  std::thread t1(worker, 10);
  std::thread t2(worker, 20);
  t1.join();
  t2.join();
  return 0;
}
