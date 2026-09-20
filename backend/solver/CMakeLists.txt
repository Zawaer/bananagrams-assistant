cmake_minimum_required(VERSION 3.10)
project(BanagramsSolver CXX)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

# Default to an optimised build. The solver is CPU-bound and runs several
# times slower unoptimised, and because its search budget is wall-clock that
# costs solutions, not just time.
if(NOT CMAKE_BUILD_TYPE AND NOT CMAKE_CONFIGURATION_TYPES)
  set(CMAKE_BUILD_TYPE Release CACHE STRING "Build type" FORCE)
endif()

add_executable(solver-server main.cpp)

# Link pthread for std::thread
find_package(Threads REQUIRED)
target_link_libraries(solver-server Threads::Threads)
