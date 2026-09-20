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

// Case conversion is done explicitly rather than through std::locale. The
// tile set is a known 22 letters, and relying on the ambient locale meant the
// Finnish ä and ö were left untouched wherever one was not configured: the
// Docker image ships no UTF-8 locale, so solved grids came back with a
// lowercase "ä" sitting among uppercase letters.
inline wchar_t toLowerChar(wchar_t c)
{
    if (c >= L'A' && c <= L'Z') return (wchar_t)(c - L'A' + L'a');
    switch (c)
    {
        case L'Ä': return L'ä';
        case L'Ö': return L'ö';
        case L'Å': return L'å';
        default:   return c;
    }
}

inline wchar_t toUpperChar(wchar_t c)
{
    if (c >= L'a' && c <= L'z') return (wchar_t)(c - L'a' + L'A');
    switch (c)
    {
        case L'ä': return L'Ä';
        case L'ö': return L'Ö';
        case L'å': return L'Å';
        default:   return c;
    }
}

inline std::wstring toLower(std::wstring str)
{
    for (wchar_t& c : str) c = toLowerChar(c);
    return str;
}

inline std::wstring toUpper(std::wstring str)
{
    for (wchar_t& c : str) c = toUpperChar(c);
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
