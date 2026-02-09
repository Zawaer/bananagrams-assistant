#ifndef UTILS_H
#define UTILS_H

#include <string>
#include <algorithm>
#include <chrono>
#include <locale>
#include <codecvt>

namespace utils
{

inline std::wstring sort(std::wstring str) {
    std::sort(str.begin(), str.end());
    return str;
}

inline std::wstring tolower(std::wstring str)
{
    for (wchar_t& c : str)
    {
        c = std::tolower(c, std::locale());
    }
    return str;
}

inline std::wstring toupper(std::wstring str)
{
    for (wchar_t& c : str)
    {
        c = std::toupper(c, std::locale());
    }
    return str;
}

inline std::wstring string2wstring(const std::string& str)
{
    std::wstring_convert<std::codecvt_utf8<wchar_t>> converter;
    return converter.from_bytes(str);
}

inline std::string wstring2string(const std::wstring& wstr)
{
    std::wstring_convert<std::codecvt_utf8<wchar_t>> converter;
    return converter.to_bytes(wstr);
}

struct Timer
{
    std::chrono::time_point<std::chrono::steady_clock> startTime, endTime;

    void Start() { startTime = std::chrono::high_resolution_clock::now(); }
    void Stop()  { endTime = std::chrono::high_resolution_clock::now(); }

    int GetMS()
    {
        auto time = endTime - startTime;
        return (int)std::chrono::duration<double, std::milli>(time).count();
    }
};

} // namespace utils

#endif // UTILS_H
