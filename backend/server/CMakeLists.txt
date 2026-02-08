cmake_minimum_required(VERSION 3.10)
project(BananagramsServer CXX)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

add_executable(bananagrams_server main.cpp)

# Link pthread for std::thread
find_package(Threads REQUIRED)
target_link_libraries(bananagrams_server Threads::Threads)
