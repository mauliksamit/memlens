#include <vector>
#include <string>
#include <memory>

int main() {
  std::vector<int> v;
  std::string s = "hello";
  auto p = std::make_unique<int>(7);
  auto q = std::make_shared<int>(8);
  return 0;
}
