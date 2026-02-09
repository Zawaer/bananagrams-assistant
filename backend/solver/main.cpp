#include <iostream>
#include <string>
#include <sstream>
#include <thread>
#include <cstring>
#include <locale>

// POSIX sockets
#include <sys/socket.h>
#include <netinet/in.h>
#include <unistd.h>

#include "solver.h"
#include "utils.h"

static const int PORT = 8080;
static WordUtil* g_wordUtil = nullptr;

// ============================================================================
// Minimal JSON helpers (no external dependency)
// ============================================================================

// Extract a string value for a given key from a simple JSON object
std::string jsonGetString(const std::string& json, const std::string& key)
{
    std::string search = "\"" + key + "\"";
    size_t pos = json.find(search);
    if (pos == std::string::npos) return "";

    pos = json.find(':', pos);
    if (pos == std::string::npos) return "";

    pos = json.find('"', pos + 1);
    if (pos == std::string::npos) return "";

    size_t end = json.find('"', pos + 1);
    if (end == std::string::npos) return "";

    return json.substr(pos + 1, end - pos - 1);
}

// Convert grid to JSON array of arrays
std::string gridToJson(const std::vector<std::vector<std::string>>& grid)
{
    std::ostringstream ss;
    ss << "[";
    for (size_t r = 0; r < grid.size(); ++r)
    {
        if (r > 0) ss << ",";
        ss << "[";
        for (size_t c = 0; c < grid[r].size(); ++c)
        {
            if (c > 0) ss << ",";
            if (grid[r][c].empty())
                ss << "null";
            else
                ss << "\"" << grid[r][c] << "\"";
        }
        ss << "]";
    }
    ss << "]";
    return ss.str();
}

// ============================================================================
// HTTP handling
// ============================================================================

std::string readFullRequest(int clientFd)
{
    std::string data;
    char buf[4096];

    // Read headers first
    while (true)
    {
        ssize_t n = recv(clientFd, buf, sizeof(buf) - 1, 0);
        if (n <= 0) break;
        buf[n] = 0;
        data += buf;

        // Check if we have the full headers
        size_t headerEnd = data.find("\r\n\r\n");
        if (headerEnd != std::string::npos)
        {
            // Check Content-Length
            size_t clPos = data.find("Content-Length:");
            if (clPos == std::string::npos)
                clPos = data.find("content-length:");

            if (clPos != std::string::npos)
            {
                int contentLength = std::stoi(data.substr(clPos + 15));
                size_t bodyStart = headerEnd + 4;
                size_t bodyReceived = data.size() - bodyStart;

                while ((int)bodyReceived < contentLength)
                {
                    n = recv(clientFd, buf, sizeof(buf) - 1, 0);
                    if (n <= 0) break;
                    buf[n] = 0;
                    data += buf;
                    bodyReceived += n;
                }
            }
            break;
        }
    }

    return data;
}

void sendResponse(int clientFd, int statusCode, const std::string& statusText,
                   const std::string& body, const std::string& contentType = "application/json")
{
    std::ostringstream resp;
    resp << "HTTP/1.1 " << statusCode << " " << statusText << "\r\n";
    resp << "Content-Type: " << contentType << "\r\n";
    resp << "Content-Length: " << body.size() << "\r\n";
    resp << "Access-Control-Allow-Origin: *\r\n";
    resp << "Access-Control-Allow-Methods: POST, GET, OPTIONS\r\n";
    resp << "Access-Control-Allow-Headers: Content-Type\r\n";
    resp << "Connection: close\r\n";
    resp << "\r\n";
    resp << body;

    std::string full = resp.str();
    send(clientFd, full.c_str(), full.size(), 0);
}

void handleClient(int clientFd)
{
    std::string request = readFullRequest(clientFd);

    // Parse method and path
    std::string method, path;
    {
        std::istringstream iss(request);
        iss >> method >> path;
    }

    // CORS preflight
    if (method == "OPTIONS")
    {
        sendResponse(clientFd, 204, "No Content", "");
        close(clientFd);
        return;
    }

    // Health check
    if (method == "GET" && path == "/health")
    {
        sendResponse(clientFd, 200, "OK", "{\"status\":\"ok\"}");
        close(clientFd);
        return;
    }

    // Solve endpoint
    if (method == "POST" && path == "/solve")
    {
        // Extract body
        size_t bodyStart = request.find("\r\n\r\n");
        std::string body = (bodyStart != std::string::npos) ? request.substr(bodyStart + 4) : "";

        std::string letters = jsonGetString(body, "letters");

        if (letters.empty())
        {
            sendResponse(clientFd, 400, "Bad Request", "{\"error\":\"Missing 'letters' field\"}");
            close(clientFd);
            return;
        }

        std::cout << "Solving for letters: " << letters << std::endl;

        utils::Timer timer;
        timer.Start();

        Board board(*g_wordUtil);
        board.hand = Hand(utils::string2wstring(letters));
        board.Reset();

        bool found = board.StartSolver();
        timer.Stop();

        if (!found)
        {
            std::cout << "No solution found (" << timer.GetMS() << "ms)" << std::endl;
            std::string resp = "{\"solved\":false,\"time_ms\":" + std::to_string(timer.GetMS()) + ",\"grid\":[]}";
            sendResponse(clientFd, 200, "OK", resp);
        }
        else
        {
            std::cout << "Solution found in " << timer.GetMS() << "ms" << std::endl;
            auto resultGrid = board.GetResultGrid();
            std::string gridJson = gridToJson(resultGrid);
            std::string resp = "{\"solved\":true,\"time_ms\":" + std::to_string(timer.GetMS()) + ",\"grid\":" + gridJson + "}";
            sendResponse(clientFd, 200, "OK", resp);
        }

        close(clientFd);
        return;
    }

    sendResponse(clientFd, 404, "Not Found", "{\"error\":\"Not found\"}");
    close(clientFd);
}

// ============================================================================
// Main
// ============================================================================

int main(int argc, char* argv[])
{
    std::locale::global(std::locale(""));

    std::string wordlistPath = "../wordlist-parser/wordlist.txt";
    if (argc > 1) wordlistPath = argv[1];

    std::cout << "Loading word list from: " << wordlistPath << std::endl;

    utils::Timer timer;
    timer.Start();
    WordUtil wordUtil(wordlistPath);
    timer.Stop();
    std::cout << "Word list loaded in " << timer.GetMS() << "ms" << std::endl;

    g_wordUtil = &wordUtil;

    // Create socket
    int serverFd = socket(AF_INET, SOCK_STREAM, 0);
    if (serverFd < 0) { perror("socket"); return 1; }

    int opt = 1;
    setsockopt(serverFd, SOL_SOCKET, SO_REUSEADDR, &opt, sizeof(opt));

    sockaddr_in addr{};
    addr.sin_family = AF_INET;
    addr.sin_addr.s_addr = INADDR_ANY;
    addr.sin_port = htons(PORT);

    if (bind(serverFd, (sockaddr*)&addr, sizeof(addr)) < 0) { perror("bind"); return 1; }
    if (listen(serverFd, 10) < 0) { perror("listen"); return 1; }

    std::cout << "\nBananagrams Solver server listening on http://localhost:" << PORT << std::endl;
    std::cout << "Endpoints:" << std::endl;
    std::cout << "  GET  /health       - Health check" << std::endl;
    std::cout << "  POST /solve        - Solve (body: {\"letters\": \"...\"})" << std::endl;

    while (true)
    {
        sockaddr_in clientAddr{};
        socklen_t clientLen = sizeof(clientAddr);
        int clientFd = accept(serverFd, (sockaddr*)&clientAddr, &clientLen);
        if (clientFd < 0) { perror("accept"); continue; }

        // Handle each request in a new thread
        std::thread(handleClient, clientFd).detach();
    }

    close(serverFd);
    return 0;
}
