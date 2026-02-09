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

std::string readFullRequest(int client_fd)
{
    std::string data;
    char buf[4096];

    // Read headers first
    while (true)
    {
        ssize_t n = recv(client_fd, buf, sizeof(buf) - 1, 0);
        if (n <= 0) break;
        buf[n] = 0;
        data += buf;

        // Check if we have the full headers
        size_t header_end = data.find("\r\n\r\n");
        if (header_end != std::string::npos)
        {
            // Check Content-Length
            size_t cl_pos = data.find("Content-Length:");
            if (cl_pos == std::string::npos)
                cl_pos = data.find("content-length:");

            if (cl_pos != std::string::npos)
            {
                int content_length = std::stoi(data.substr(cl_pos + 15));
                size_t body_start = header_end + 4;
                size_t body_received = data.size() - body_start;

                while ((int)body_received < content_length)
                {
                    n = recv(client_fd, buf, sizeof(buf) - 1, 0);
                    if (n <= 0) break;
                    buf[n] = 0;
                    data += buf;
                    body_received += n;
                }
            }
            break;
        }
    }

    return data;
}

void sendResponse(int client_fd, int status_code, const std::string& status_text,
                   const std::string& body, const std::string& content_type = "application/json")
{
    std::ostringstream resp;
    resp << "HTTP/1.1 " << status_code << " " << status_text << "\r\n";
    resp << "Content-Type: " << content_type << "\r\n";
    resp << "Content-Length: " << body.size() << "\r\n";
    resp << "Access-Control-Allow-Origin: *\r\n";
    resp << "Access-Control-Allow-Methods: POST, GET, OPTIONS\r\n";
    resp << "Access-Control-Allow-Headers: Content-Type\r\n";
    resp << "Connection: close\r\n";
    resp << "\r\n";
    resp << body;

    std::string full = resp.str();
    send(client_fd, full.c_str(), full.size(), 0);
}

void handleClient(int client_fd)
{
    std::string request = readFullRequest(client_fd);

    // Parse method and path
    std::string method, path;
    {
        std::istringstream iss(request);
        iss >> method >> path;
    }

    // CORS preflight
    if (method == "OPTIONS")
    {
        sendResponse(client_fd, 204, "No Content", "");
        close(client_fd);
        return;
    }

    // Health check
    if (method == "GET" && path == "/health")
    {
        sendResponse(client_fd, 200, "OK", "{\"status\":\"ok\"}");
        close(client_fd);
        return;
    }

    // Solve endpoint
    if (method == "POST" && path == "/solve")
    {
        // Extract body
        size_t body_start = request.find("\r\n\r\n");
        std::string body = (body_start != std::string::npos) ? request.substr(body_start + 4) : "";

        std::string letters = jsonGetString(body, "letters");

        if (letters.empty())
        {
            sendResponse(client_fd, 400, "Bad Request", "{\"error\":\"Missing 'letters' field\"}");
            close(client_fd);
            return;
        }

        std::cout << "Solving for letters: " << letters << std::endl;

        utils::Timer timer;
        timer.Start();

        Board board(*g_wordUtil);
        board.hand = Hand(utils::string2wstring(letters));
        board.reset();

        bool found = board.startSolver();
        timer.Stop();

        if (!found)
        {
            std::cout << "No solution found (" << timer.GetMS() << "ms)" << std::endl;
            std::string resp = "{\"solved\":false,\"time_ms\":" + std::to_string(timer.GetMS()) + ",\"grid\":[]}";
            sendResponse(client_fd, 200, "OK", resp);
        }
        else
        {
            std::cout << "Solution found in " << timer.GetMS() << "ms" << std::endl;
            auto result_grid = board.getResultGrid();
            std::string grid_json = gridToJson(result_grid);
            std::string resp = "{\"solved\":true,\"time_ms\":" + std::to_string(timer.GetMS()) + ",\"grid\":" + grid_json + "}";
            sendResponse(client_fd, 200, "OK", resp);
        }

        close(client_fd);
        return;
    }

    sendResponse(client_fd, 404, "Not Found", "{\"error\":\"Not found\"}");
    close(client_fd);
}

// ============================================================================
// Main
// ============================================================================

int main(int argc, char* argv[])
{
    std::locale::global(std::locale(""));

    std::string wordlist_path = "../wordlist-parser/wordlist.txt";
    if (argc > 1) wordlist_path = argv[1];

    std::cout << "Loading word list from: " << wordlist_path << std::endl;

    utils::Timer timer;
    timer.Start();
    WordUtil wordUtil(wordlist_path);
    timer.Stop();
    std::cout << "Word list loaded in " << timer.GetMS() << "ms" << std::endl;

    g_wordUtil = &wordUtil;

    // Create socket
    int server_fd = socket(AF_INET, SOCK_STREAM, 0);
    if (server_fd < 0) { perror("socket"); return 1; }

    int opt = 1;
    setsockopt(server_fd, SOL_SOCKET, SO_REUSEADDR, &opt, sizeof(opt));

    sockaddr_in addr{};
    addr.sin_family = AF_INET;
    addr.sin_addr.s_addr = INADDR_ANY;
    addr.sin_port = htons(PORT);

    if (bind(server_fd, (sockaddr*)&addr, sizeof(addr)) < 0) { perror("bind"); return 1; }
    if (listen(server_fd, 10) < 0) { perror("listen"); return 1; }

    std::cout << "\nBananagrams solver server listening on http://localhost:" << PORT << std::endl;
    std::cout << "Endpoints:" << std::endl;
    std::cout << "  GET  /health       - Health check" << std::endl;
    std::cout << "  POST /solve        - Solve (body: {\"letters\": \"...\"})" << std::endl;

    while (true)
    {
        sockaddr_in client_addr{};
        socklen_t client_len = sizeof(client_addr);
        int client_fd = accept(server_fd, (sockaddr*)&client_addr, &client_len);
        if (client_fd < 0) { perror("accept"); continue; }

        // Handle each request in a new thread
        std::thread(handleClient, client_fd).detach();
    }

    close(server_fd);
    return 0;
}
