#include <iostream>
#include <memory>
#include <string>
#include <utility>
#include <vector>

struct Student {
    std::string name;
    int score;
    std::unique_ptr<int> bonus;

    Student(std::string n, int s)
        : name(std::move(n)), score(s), bonus(std::make_unique<int>(5)) {}
};

int main() {
    std::vector<std::unique_ptr<Student>> students;

    for (int i = 0; i < 4; ++i) {
        students.push_back(
            std::make_unique<Student>("student-" + std::to_string(i), 70 + i * 5)
        );
    }

    int total = 0;

    for (const auto& student : students) {
        total += student->score;

        if (student->bonus) {
            total += *student->bonus;
        }
    }

    auto best = std::make_unique<Student>("best", total / 4);

    std::cout << "Average: " << total / students.size() << "\n";
    std::cout << "Best: " << best->name << "\n";

    return 0;
}