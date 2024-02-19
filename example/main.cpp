#include <iostream>
#include <vector>

void printVector(std::vector<int> v) {
    for (int i = 0; i < v.size(); ++i) {
        std::cout << v[i] << std::endl;
    }
}

int main() {
    std::vector<int> v;
    int unusedVar;
    unusedVar = 3;
    v.push_back(1);
    v.push_back(2);
    v.push_back(3);

    printVector(v);
}