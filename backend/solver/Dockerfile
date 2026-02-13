# Use Ubuntu base image with build tools
FROM ubuntu:22.04

# Install build dependencies
RUN apt-get update && apt-get install -y \
    g++ \
    cmake \
    make \
    && rm -rf /var/lib/apt/lists/*

# Set working directory
WORKDIR /app

# Copy source files from solver directory
COPY solver.h utils.h main.cpp CMakeLists.txt ./

# Copy wordlist from adjacent directory
# When Root Directory is set in Railway, paths are relative to repo root
RUN mkdir -p wordlist-parser
COPY ../wordlist-parser/wordlist.txt ./wordlist.txt

# Build the application
RUN mkdir -p build && cd build && cmake .. && make

# Expose port
EXPOSE 8080

# Run the server
CMD ["./build/solver-server", "./wordlist.txt"]
