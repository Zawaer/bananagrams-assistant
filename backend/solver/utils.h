#ifndef UTILS_H
#define UTILS_H

#include <string>
#include <algorithm>
#include <chrono>
#include <locale>

// Suppress deprecation warnings for codecvt (deprecated in C++17 but still functional)
#if defined(__clang__)
#pragma clang diagnostic push
#pragma clang diagnostic ignored "-Wdeprecated-declarations"
#elif defined(__GNUC__)
#pragma GCC diagnostic push
#pragma GCC diagnostic ignored "-Wdeprecated-declarations"
#endif
#include <codecvt>
#if defined(__clang__)
#pragma clang diagnostic pop
#elif defined(__GNUC__)
#pragma GCC diagnostic pop
#endif

namespace utils
{

inline std::wstring sort(std::wstring str) {
    std::sort(str.begin(), str.end());
    return str;
}

inline std::wstring toLower(std::wstring str)
{
    for (wchar_t& c : str)
    {
        c = std::tolower(c, std::locale());
    }
    return str;
}

inline std::wstring toUpper(std::wstring str)
{
    for (wchar_t& c : str)
    {
        c = std::toupper(c, std::locale());
    }
    return str;
}

inline std::wstring stringToWString(const std::string& str)
{
#if defined(__clang__)
#pragma clang diagnostic push
#pragma clang diagnostic ignored "-Wdeprecated-declarations"
#elif defined(__GNUC__)
#pragma GCC diagnostic push
#pragma GCC diagnostic ignored "-Wdeprecated-declarations"
#endif
    std::wstring_convert<std::codecvt_utf8<wchar_t>> converter;
    auto res = converter.from_bytes(str);
#if defined(__clang__)
#pragma clang diagnostic pop
#elif defined(__GNUC__)
#pragma GCC diagnostic pop
#endif
    return res;
}

inline std::string wstringToString(const std::wstring& wstr)
{
#if defined(__clang__)
#pragma clang diagnostic push
#pragma clang diagnostic ignored "-Wdeprecated-declarations"
#elif defined(__GNUC__)
#pragma GCC diagnostic push
#pragma GCC diagnostic ignored "-Wdeprecated-declarations"
#endif
    std::wstring_convert<std::codecvt_utf8<wchar_t>> converter;
    auto res = converter.to_bytes(wstr);
#if defined(__clang__)
#pragma clang diagnostic pop
#elif defined(__GNUC__)
#pragma GCC diagnostic pop
#endif
    return res;
}

struct Timer
{
    std::chrono::time_point<std::chrono::high_resolution_clock> start_time, end_time;

    void start() { start_time = std::chrono::high_resolution_clock::now(); }
    void stop()  { end_time = std::chrono::high_resolution_clock::now(); }

    int getMs()
    {
        auto time = end_time - start_time;
        return (int)std::chrono::duration<double, std::milli>(time).count();
    }
};

} // namespace utils

#endif // UTILS_H
