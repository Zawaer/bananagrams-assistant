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
#include <csignal>

#include <memory>
#include <mutex>
#include <codecvt>

#include "solver.h"
#include "utils.h"

static const int DEFAULT_PORT = 8080;  // SOLVER_PORT overrides it
// ============================================================================
// Lexicon and rules
//
// The lexicon is every word with its word classes and frequency rank (see
// backend/wordlist-parser/make-lexicon.py). Each request can carry house
// rules; the solver builds a dictionary of just the words those rules allow,
// and every run on the board must come from it, crossings included.
// ============================================================================

std::string jsonGetString(const std::string& json, const std::string& key);

struct LexEntry
{
    std::wstring word;
    std::string flags;  // n v a u o word classes, p = plural, x = abbreviation
    int rank;           // frequency rank, 0 = not among the common words
    // Usage labels for words with no standard meaning: one label set per
    // meaning (k colloquial, s slang, r old/rare, d derogatory, m dialect).
    // Empty for ordinary words.
    std::vector<std::string> meanings;
};

static std::vector<LexEntry> g_lexicon;

// Legit mode keeps words up to this frequency rank ("common": "1"); a number
// above 1 sets the cutoff directly, e.g. "20000" for the app's strict level.
static const int LEGIT_RANK = 50000;

struct Rules
{
    int max_rank = 0;          // 0 = any word
    int min_len = 2;
    int max_len = 99;
    std::string classes;       // allowed classes; empty = all
    bool plurals = true;
    std::string labels = "ksrdm";  // allowed usage labels
    std::vector<std::wstring> banned;

    std::string key() const
    {
        std::ostringstream k;
        k << max_rank << '|' << min_len << '|' << max_len << '|' << classes << '|' << plurals << '|' << labels << '|';
        for (const auto& b : banned) k << utils::wstringToString(b) << ',';
        return k.str();
    }

    bool allows(const LexEntry& e) const
    {
        int len = (int)e.word.length();
        if (len < min_len || len > max_len) return false;
        if (max_rank && (e.rank == 0 || e.rank > max_rank)) return false;
        if (max_rank && e.flags.find('x') != std::string::npos) return false;
        if (!plurals && e.flags.find('p') != std::string::npos) return false;
        // A labelled word passes if one of its meanings uses only allowed labels.
        if (!e.meanings.empty())
        {
            bool any = false;
            for (const auto& m : e.meanings)
                if (std::all_of(m.begin(), m.end(), [&](char c) { return labels.find(c) != std::string::npos; }))
                { any = true; break; }
            if (!any) return false;
        }
        if (!classes.empty())
        {
            bool any = false;
            for (char c : e.flags)
                if (c != 'p' && c != 'x' && classes.find(c) != std::string::npos) { any = true; break; }
            if (!any) return false;
        }
        return std::find(banned.begin(), banned.end(), e.word) == banned.end();
    }
};

static int toInt(const std::string& s, int fallback)
{
    try { return s.empty() ? fallback : std::stoi(s); } catch (...) { return fallback; }
}

static Rules parseRules(const std::string& body)
{
    Rules r;
    // "mode": "common" is the older way to ask for legit mode.
    std::string common = jsonGetString(body, "common");
    if (jsonGetString(body, "mode") == "common" && common.empty()) r.max_rank = LEGIT_RANK;
    else r.max_rank = common == "1" ? LEGIT_RANK : toInt(common, 0) > 1 ? toInt(common, 0) : 0;
    r.min_len = std::max(2, toInt(jsonGetString(body, "min_len"), 2));
    r.max_len = std::max(r.min_len, toInt(jsonGetString(body, "max_len"), 99));
    r.classes = jsonGetString(body, "classes");
    r.plurals = jsonGetString(body, "plurals") != "0";
    // "labels": the usage labels allowed; absent = all.
    if (body.find("\"labels\"") != std::string::npos) r.labels = jsonGetString(body, "labels");

    std::wstring banned = utils::stringToWString(jsonGetString(body, "banned"));
    std::wstring cur;
    for (wchar_t c : banned + L",")
    {
        if (c == L',') { if (!cur.empty()) r.banned.push_back(cur); cur.clear(); }
        else cur += (wchar_t)std::towlower(c);
    }
    std::sort(r.banned.begin(), r.banned.end());
    return r;
}

// Building a dictionary takes ~100 ms for the full list, so keep the last few
// rule sets. A dump check fires many solves with the same rules at once.
static std::mutex g_cacheMutex;
static std::vector<std::pair<std::string, std::shared_ptr<WordUtil>>> g_cache;
static const size_t CACHE_SIZE = 4;

static std::shared_ptr<WordUtil> dictionaryFor(const Rules& rules)
{
    std::string key = rules.key();
    std::lock_guard<std::mutex> lock(g_cacheMutex);
    for (size_t i = 0; i < g_cache.size(); i++)
        if (g_cache[i].first == key)
        {
            auto hit = g_cache[i];
            g_cache.erase(g_cache.begin() + i);
            g_cache.insert(g_cache.begin(), hit);
            return hit.second;
        }

    std::vector<std::wstring> words;
    for (const auto& e : g_lexicon)
        if (rules.allows(e)) words.push_back(e.word);
    auto dict = std::make_shared<WordUtil>(std::move(words), "rules " + key);
    g_cache.insert(g_cache.begin(), {key, dict});
    if (g_cache.size() > CACHE_SIZE) g_cache.pop_back();
    return dict;
}

static void loadLexicon(const std::string& path)
{
    std::wifstream in(path);
    if (!in.is_open()) throw std::runtime_error("Failed to load lexicon: " + path);
#if defined(__GNUC__)
#pragma GCC diagnostic push
#pragma GCC diagnostic ignored "-Wdeprecated-declarations"
#endif
    in.imbue(std::locale(std::locale(), new std::codecvt_utf8<wchar_t>));
#if defined(__GNUC__)
#pragma GCC diagnostic pop
#endif
    std::wstring line;
    while (std::getline(in, line))
    {
        std::wistringstream row(line);
        std::wstring word, flags, rankText, labelText;
        if (!std::getline(row, word, L'\t') || !std::getline(row, flags, L'\t')) continue;
        std::getline(row, rankText, L'\t');
        std::getline(row, labelText);
        LexEntry e{word, utils::wstringToString(flags), toInt(utils::wstringToString(rankText), 0), {}};
        std::string meanings = utils::wstringToString(labelText), cur;
        for (char c : meanings + "|")
        {
            if (c == '|') { if (!cur.empty()) e.meanings.push_back(cur); cur.clear(); }
            else if (!std::isspace((unsigned char)c)) cur += c;
        }
        g_lexicon.push_back(std::move(e));
    }
    std::cout << "Lexicon: " << g_lexicon.size() << " words" << std::endl;
}

// ============================================================================
// Minimal JSON helpers (no external dependency)
// ============================================================================

// Append a Unicode code point to a UTF-8 encoded std::string
static void appendUtf8(std::string& out, unsigned int cp)
{
    if (cp <= 0x7F)
    {
        out += (char)cp;
    }
    else if (cp <= 0x7FF)
    {
        out += (char)(0xC0 | (cp >> 6));
        out += (char)(0x80 | (cp & 0x3F));
    }
    else if (cp <= 0xFFFF)
    {
        out += (char)(0xE0 | (cp >> 12));
        out += (char)(0x80 | ((cp >> 6) & 0x3F));
        out += (char)(0x80 | (cp & 0x3F));
    }
    else
    {
        out += (char)(0xF0 | (cp >> 18));
        out += (char)(0x80 | ((cp >> 12) & 0x3F));
        out += (char)(0x80 | ((cp >> 6) & 0x3F));
        out += (char)(0x80 | (cp & 0x3F));
    }
}

static bool parseHex4(const std::string& s, size_t pos, unsigned int& out)
{
    if (pos + 4 > s.size()) return false;
    unsigned int v = 0;
    for (int i = 0; i < 4; i++)
    {
        char c = s[pos + i];
        v <<= 4;
        if (c >= '0' && c <= '9')      v |= (unsigned)(c - '0');
        else if (c >= 'a' && c <= 'f') v |= (unsigned)(c - 'a' + 10);
        else if (c >= 'A' && c <= 'F') v |= (unsigned)(c - 'A' + 10);
        else return false;
    }
    out = v;
    return true;
}

// Extract a string value for a given key from a simple JSON object.
// Handles backslash escapes, including \uXXXX (and surrogate pairs), so that
// clients which emit ASCII-safe JSON - Python's json.dumps does this by
// default, turning "ä" into "ä" - are decoded correctly rather than
// silently producing a corrupted letter string.
std::string jsonGetString(const std::string& json, const std::string& key)
{
    std::string search = "\"" + key + "\"";
    size_t pos = json.find(search);
    if (pos == std::string::npos) return "";

    pos = json.find(':', pos + search.size());
    if (pos == std::string::npos) return "";

    pos = json.find('"', pos + 1);
    if (pos == std::string::npos) return "";
    pos++; // first character of the value

    std::string out;
    while (pos < json.size())
    {
        char c = json[pos];

        if (c == '"') break;          // end of string

        if (c != '\\')
        {
            out += c;
            pos++;
            continue;
        }

        if (pos + 1 >= json.size()) break;
        char esc = json[pos + 1];
        pos += 2;

        switch (esc)
        {
            case '"':  out += '"';  break;
            case '\\': out += '\\'; break;
            case '/':  out += '/';  break;
            case 'b':  out += '\b'; break;
            case 'f':  out += '\f'; break;
            case 'n':  out += '\n'; break;
            case 'r':  out += '\r'; break;
            case 't':  out += '\t'; break;
            case 'u':
            {
                unsigned int cp = 0;
                if (!parseHex4(json, pos, cp)) return out;
                pos += 4;

                // High surrogate: pull in the matching low surrogate.
                if (cp >= 0xD800 && cp <= 0xDBFF &&
                    pos + 1 < json.size() && json[pos] == '\\' && json[pos + 1] == 'u')
                {
                    unsigned int low = 0;
                    if (parseHex4(json, pos + 2, low) && low >= 0xDC00 && low <= 0xDFFF)
                    {
                        cp = 0x10000 + ((cp - 0xD800) << 10) + (low - 0xDC00);
                        pos += 6;
                    }
                }

                appendUtf8(out, cp);
                break;
            }
            default:
                out += esc;
                break;
        }
    }

    return out;
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
// Search trace (opt-in): what the app animates while it waits
//
// A placement is ["WORD", row, col, 1 if across else 0] in the solver's own
// board coordinates; an undo is 0. Coordinates only matter relative to each
// other, and the solution path lays out exactly the returned grid.
// ============================================================================

static void placementJson(std::ostringstream& ss, const Board& board, const Board::Placement& p)
{
    ss << "[\"" << utils::wstringToString(utils::toUpper(board.words().entries[p.entry].word)) << "\","
       << p.row << ',' << p.col << ',' << (p.horizontal ? 1 : 0) << ']';
}

static void placementsJson(std::ostringstream& ss, const Board& board, const std::vector<Board::Placement>& list)
{
    ss << '[';
    for (size_t i = 0; i < list.size(); i++)
    {
        if (i) ss << ',';
        placementJson(ss, board, list[i]);
    }
    ss << ']';
}

static std::string traceJson(const Board& board)
{
    std::ostringstream ss;
    ss << "{\"nodes\":" << board.nodesVisited()
       << ",\"truncated\":" << (board.traceTruncated() ? "true" : "false")
       << ",\"events\":[";
    for (size_t i = 0; i < board.events.size(); i++)
    {
        if (i) ss << ',';
        const auto& e = board.events[i];
        if (e.entry < 0) ss << '0';
        else placementJson(ss, board, e);
    }
    ss << "],\"path\":";
    placementsJson(ss, board, board.placed());
    ss << ",\"closest\":";
    placementsJson(ss, board, board.closest());
    ss << ",\"closest_tiles\":" << board.closestTiles() << '}';
    return ss.str();
}

static bool sendAll(int fd, const std::string& data)
{
    size_t off = 0;
    while (off < data.size())
    {
        ssize_t n = send(fd, data.data() + off, data.size() - off, MSG_NOSIGNAL);
        if (n <= 0) return false;
        off += (size_t)n;
    }
    return true;
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

        // "trace": "1" adds the search trace to the response. "stream": "1"
        // (implies trace) answers with newline-delimited JSON instead: a
        // {"frame": ...} snapshot of the board every ~80 ms while the search
        // runs, then the usual result object as the last line.
        const bool stream = jsonGetString(body, "stream") == "1";
        const bool trace = stream || jsonGetString(body, "trace") == "1";

        std::cout << "Solving for letters: " << letters << (stream ? " (stream)" : trace ? " (trace)" : "") << std::endl;

        utils::Timer timer;
        timer.start();

        std::shared_ptr<WordUtil> dict = dictionaryFor(parseRules(body));
        Board board(*dict);
        board.hand = Hand(utils::stringToWString(letters));
        board.reset();
        board.trace = trace;

        bool client_gone = false;
        if (stream)
        {
            std::string head =
                "HTTP/1.1 200 OK\r\n"
                "Content-Type: application/x-ndjson\r\n"
                "Cache-Control: no-cache\r\n"
                "X-Accel-Buffering: no\r\n"
                "Access-Control-Allow-Origin: *\r\n"
                "Connection: close\r\n\r\n";
            client_gone = !sendAll(client_fd, head);

            auto started = std::chrono::steady_clock::now();
            auto last = started;
            board.on_tick = [&]() {
                auto now = std::chrono::steady_clock::now();
                if (now - last < std::chrono::milliseconds(80)) return true;
                last = now;
                std::ostringstream ss;
                ss << "{\"frame\":{\"ms\":"
                   << std::chrono::duration_cast<std::chrono::milliseconds>(now - started).count()
                   << ",\"nodes\":" << board.nodesVisited()
                   << ",\"best\":" << board.closestTiles() << ",\"path\":";
                placementsJson(ss, board, board.placed());
                ss << "}}\n";
                // A client that has gone away stops the search.
                if (!sendAll(client_fd, ss.str())) client_gone = true;
                return !client_gone;
            };
        }

        bool found = !client_gone && board.startSolver();
        timer.stop();

        std::cout << (found ? "Solution found in " : "No solution found in ") << timer.getMs() << " ms" << std::endl;
        std::string resp = "{\"solved\":" + std::string(found ? "true" : "false") +
                           ",\"time_ms\":" + std::to_string(timer.getMs()) +
                           ",\"grid\":" + (found ? gridToJson(board.getResultGrid()) : "[]") +
                           // Cheap numbers about the search, for the app's stats.
                           ",\"nodes\":" + std::to_string(board.nodesVisited()) +
                           ",\"budget_hit\":" + (board.hitBudget() ? "true" : "false") +
                           ",\"dict_words\":" + std::to_string(dict->words.size());
        if (trace) resp += ",\"trace\":" + traceJson(board);
        resp += "}";

        if (stream) { if (!client_gone) sendAll(client_fd, resp + "\n"); }
        else sendResponse(client_fd, 200, "OK", resp);

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
    // A client that hangs up mid-response must not kill the whole server.
    signal(SIGPIPE, SIG_IGN);

    int port = DEFAULT_PORT;
    if (const char* env = std::getenv("SOLVER_PORT")) port = toInt(env, DEFAULT_PORT);

    std::string lexicon_path = "../wordlist-parser/lexicon.tsv";
    if (argc > 1) lexicon_path = argv[1];

    utils::Timer timer;
    timer.start();
    loadLexicon(lexicon_path);
    dictionaryFor(Rules{});  // warm the default (no rules) dictionary
    timer.stop();
    std::cout << "Ready in " << timer.getMs() << " ms" << std::endl;

    // Create socket
    int server_fd = socket(AF_INET, SOCK_STREAM, 0);
    if (server_fd < 0) { perror("socket"); return 1; }

    int opt = 1;
    setsockopt(server_fd, SOL_SOCKET, SO_REUSEADDR, &opt, sizeof(opt));

    sockaddr_in addr{};
    addr.sin_family = AF_INET;
    addr.sin_addr.s_addr = INADDR_ANY;
    addr.sin_port = htons(port);

    if (bind(server_fd, (sockaddr*)&addr, sizeof(addr)) < 0) { perror("bind"); return 1; }
    if (listen(server_fd, 10) < 0) { perror("listen"); return 1; }

    std::cout << "\nBananagrams solver server listening on http://localhost:" << port << std::endl;
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
