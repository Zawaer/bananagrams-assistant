#ifndef SOLVER_H
#define SOLVER_H

#include <vector>
#include <string>
#include <algorithm>
#include <unordered_map>
#include <unordered_set>
#include <map>
#include <array>
#include <fstream>
#include <iostream>
#include <locale>
#include <cwctype>
#include <chrono>
#include <cstdint>

#include "utils.h"

// Letters are indexed into a fixed-width count vector. The Finnish tile set has
// 22 letters; the wordlist has a few more. 32 leaves room and lets us use a
// uint32_t presence mask as a fast rejection filter.
static const int MAX_LETTERS = 32;

// ============================================================================
// WordUtil - loads the word list and builds the lookup indices
// ============================================================================

struct WordEntry
{
    std::wstring word;
    std::array<uint8_t, MAX_LETTERS> counts{};
    uint32_t mask = 0;
    int length = 0;
};

class WordUtil
{
public:
    WordUtil() : longest_word_length(1) {}
    WordUtil(const std::string& wordlist_filename);

    // Kept for compatibility: first word of `length` makeable from `hand`.
    std::wstring getWordWithLength(const std::wstring& hand, int length) const;

    int indexOf(wchar_t c) const
    {
        auto it = letter_index.find(c);
        return it == letter_index.end() ? -1 : it->second;
    }

    bool isValidWord(const std::wstring& word) const
    {
        return word_set.find(word) != word_set.end();
    }

    std::string wordlist_filename;
    int longest_word_length;
    std::vector<std::wstring> words;
    std::unordered_map<std::wstring, std::vector<std::wstring>> anagrams;
    std::vector<std::pair<wchar_t, int>> letter_frequencies;

    // Search indices. `entries` is sorted by descending word length so the
    // solver can skip straight past words that are too long for the hand.
    std::vector<WordEntry> entries;
    std::vector<int> length_start;   // length_start[L] = first entry with length <= L
    std::unordered_map<wchar_t, int> letter_index;
    std::unordered_set<std::wstring> word_set;
};

WordUtil::WordUtil(const std::string& wordlist_filename)
    : wordlist_filename(wordlist_filename), longest_word_length(1)
{
    std::wifstream stream(wordlist_filename);
    if (!stream.is_open() || !stream.good()) {
        std::cerr << "Error: Could not open wordlist file: " << wordlist_filename << std::endl;
        throw std::runtime_error("Failed to load wordlist: " + wordlist_filename);
    }

#if defined(__clang__)
#pragma clang diagnostic push
#pragma clang diagnostic ignored "-Wdeprecated-declarations"
#elif defined(__GNUC__)
#pragma GCC diagnostic push
#pragma GCC diagnostic ignored "-Wdeprecated-declarations"
#endif
    stream.imbue(std::locale(std::locale(), new std::codecvt_utf8<wchar_t>));
#if defined(__clang__)
#pragma clang diagnostic pop
#elif defined(__GNUC__)
#pragma GCC diagnostic pop
#endif

    std::wstring line;
    std::map<wchar_t, int> frequency_map;

    while (std::getline(stream, line))
    {
        while (!line.empty() && std::iswspace(line.back()))
            line.pop_back();

        if (line.length() < 2) continue;

        if ((int)line.length() > longest_word_length)
            longest_word_length = (int)line.length();

        words.emplace_back(line);
        word_set.insert(line);
        anagrams[utils::sort(line)].emplace_back(line);

        for (wchar_t letter : line)
            if (!std::iswspace(letter))
                frequency_map[letter]++;
    }

    letter_frequencies = std::vector<std::pair<wchar_t, int>>(frequency_map.begin(), frequency_map.end());
    std::sort(letter_frequencies.begin(), letter_frequencies.end(),
        [](const std::pair<wchar_t, int>& a, const std::pair<wchar_t, int>& b) {
            return a.second < b.second;
        });

    // Assign a slot to each distinct letter, rarest first so the common
    // letters land in low bits (purely cosmetic, but keeps masks tidy).
    int next_index = 0;
    for (const auto& [letter, freq] : letter_frequencies)
    {
        (void)freq;
        if (next_index >= MAX_LETTERS) break;
        letter_index[letter] = next_index++;
    }

    // Build one entry per word. Words containing a letter that didn't fit in
    // the index are dropped from the search set (they can never be spelled
    // from a tile hand anyway).
    entries.reserve(words.size());
    for (const auto& word : words)
    {
        WordEntry e;
        e.word = word;
        e.length = (int)word.length();

        bool ok = true;
        for (wchar_t c : word)
        {
            int idx = indexOf(c);
            if (idx < 0) { ok = false; break; }
            e.counts[idx]++;
            e.mask |= (1u << idx);
        }
        if (ok) entries.emplace_back(std::move(e));
    }

    std::sort(entries.begin(), entries.end(),
        [](const WordEntry& a, const WordEntry& b) { return a.length > b.length; });

    // length_start[L] = index of the first entry whose length is <= L.
    length_start.assign(longest_word_length + 2, 0);
    for (int L = longest_word_length + 1; L >= 0; --L)
    {
        int start = 0;
        while (start < (int)entries.size() && entries[start].length > L) start++;
        length_start[L] = start;
    }

    std::cout << "Loaded " << words.size() << " words from " << wordlist_filename
              << " (" << entries.size() << " indexed, " << letter_index.size()
              << " distinct letters)" << std::endl;
}

std::wstring WordUtil::getWordWithLength(const std::wstring& hand, int length) const
{
    std::array<uint8_t, MAX_LETTERS> have{};
    for (wchar_t c : hand)
    {
        int idx = indexOf(c);
        if (idx >= 0) have[idx]++;
    }

    for (const auto& e : entries)
    {
        if (e.length != length) continue;
        bool can_make = true;
        for (int i = 0; i < MAX_LETTERS; i++)
            if (e.counts[i] > have[i]) { can_make = false; break; }
        if (can_make) return e.word;
    }
    return L"";
}

// ============================================================================
// Hand - the player's tiles
// ============================================================================

class Hand
{
public:
    Hand() {}
    Hand(const std::wstring& tiles) : tiles(utils::toLower(tiles)) {}

    void removeWordFromTiles(const std::wstring& word)
    {
        for (size_t i = 0; i < word.length(); i++)
        {
            size_t pos = tiles.find(word[i]);
            if (pos != std::wstring::npos)
                tiles.erase(pos, 1);
        }
    }

    std::wstring tiles;
};

// ============================================================================
// Board - the grid and the backtracking search
// ============================================================================

class Board
{
public:
    Board() : word_util_ptr(nullptr) {}
    Board(const WordUtil& word_util, bool accept_duplicates = false);

    // Sizes the grid for the current hand. startSolver() does this itself;
    // kept public because callers have historically called it explicitly.
    void reset() { resetGrid(); }

    bool startSolver();
    std::vector<std::vector<std::string>> getResultGrid() const;

    // Diagnostics, filled in by startSolver().
    long long nodesVisited() const { return nodes; }
    bool hitBudget() const { return budget_exhausted; }

    Hand hand;

    // Search budget. The search is exhaustive within these limits; they exist
    // so a pathological hand fails fast instead of running forever.
    long long max_nodes = 300000;
    int max_ms = 5000;

private:
    wchar_t at(int r, int c) const
    {
        if (r < 0 || r >= height || c < 0 || c >= width) return 0;
        return cells[r * width + c];
    }

    void resetGrid();
    bool runIsValid(int r, int c, bool vertical) const;
    bool tryPlace(const std::wstring& word, int row, int col, bool horizontal,
                  bool require_overlap, std::vector<int>& written);
    bool search();
    bool outOfBudget();

    const WordUtil* word_util_ptr;
    bool accept_duplicates = false;

    std::vector<wchar_t> cells;
    int width = 0;
    int height = 0;

    std::unordered_set<std::wstring> used_words;
    std::array<uint8_t, MAX_LETTERS> hand_counts{};
    uint32_t hand_mask = 0;

    long long nodes = 0;
    bool budget_exhausted = false;
    std::chrono::steady_clock::time_point deadline;
};

Board::Board(const WordUtil& word_util, bool accept_duplicates)
    : word_util_ptr(&word_util), accept_duplicates(accept_duplicates)
{
}

void Board::resetGrid()
{
    int n = (int)hand.tiles.length();
    // Worst case a solution is a single straight word of length n, plus a
    // one-cell margin on every side for the boundary checks.
    width = height = std::max(10, n * 2 + 5);
    cells.assign((size_t)width * height, 0);
}

// The maximal run through (r,c) perpendicular to the word just placed must be
// either a single letter or a real dictionary word.
bool Board::runIsValid(int r, int c, bool vertical) const
{
    int dr = vertical ? 1 : 0;
    int dc = vertical ? 0 : 1;

    int sr = r, sc = c;
    while (at(sr - dr, sc - dc) != 0) { sr -= dr; sc -= dc; }

    std::wstring run;
    int cr = sr, cc = sc;
    while (at(cr, cc) != 0) { run += at(cr, cc); cr += dr; cc += dc; }

    if (run.length() < 2) return true;
    return word_util_ptr->isValidWord(run);
}

bool Board::tryPlace(const std::wstring& word, int row, int col, bool horizontal,
                     bool require_overlap, std::vector<int>& written)
{
    const int L = (int)word.size();

    // Every cell of the word must be on the board, with a margin so the
    // perpendicular-run scan can't walk off the edge.
    for (int i = 0; i < L; i++)
    {
        int r = horizontal ? row : row + i;
        int c = horizontal ? col + i : col;
        if (r < 1 || r >= height - 1 || c < 1 || c >= width - 1) return false;
    }

    // The cells immediately before and after must be empty, so the run we
    // create is exactly `word` and not a longer (invalid) string.
    if (horizontal)
    {
        if (at(row, col - 1) != 0 || at(row, col + L) != 0) return false;
    }
    else
    {
        if (at(row - 1, col) != 0 || at(row + L, col) != 0) return false;
    }

    int overlaps = 0;
    for (int i = 0; i < L; i++)
    {
        int r = horizontal ? row : row + i;
        int c = horizontal ? col + i : col;
        wchar_t existing = cells[r * width + c];
        if (existing == 0) continue;
        if (existing != word[i]) return false;
        overlaps++;
    }

    // Every word after the first has to hook onto what's already there; that
    // is what keeps the finished grid a single connected component.
    if (require_overlap && overlaps == 0) return false;
    if (overlaps == L) return false; // consumes no tiles

    written.clear();
    for (int i = 0; i < L; i++)
    {
        int r = horizontal ? row : row + i;
        int c = horizontal ? col + i : col;
        int idx = r * width + c;
        if (cells[idx] == 0)
        {
            cells[idx] = word[i];
            written.push_back(idx);
        }
    }

    for (int idx : written)
    {
        if (!runIsValid(idx / width, idx % width, horizontal))
        {
            for (int w : written) cells[w] = 0;
            written.clear();
            return false;
        }
    }

    return true;
}

bool Board::outOfBudget()
{
    if (nodes >= max_nodes) { budget_exhausted = true; return true; }
    if ((nodes & 0x3F) == 0 && std::chrono::steady_clock::now() >= deadline)
    {
        budget_exhausted = true;
        return true;
    }
    return false;
}

bool Board::search()
{
    if (hand.tiles.empty()) return true;
    if (outOfBudget()) return false;
    nodes++;

    const WordUtil& wu = *word_util_ptr;
    const int hand_size = (int)hand.tiles.length();

    // Collect the distinct letters currently on the board and where they are.
    std::unordered_map<wchar_t, std::vector<int>> board_letters;
    uint32_t board_mask = 0;
    for (int idx = 0; idx < (int)cells.size(); idx++)
    {
        wchar_t ch = cells[idx];
        if (ch == 0) continue;
        board_letters[ch].push_back(idx);
        int li = wu.indexOf(ch);
        if (li >= 0) board_mask |= (1u << li);
    }

    const uint32_t allowed_mask = hand_mask | board_mask;

    // A candidate word crosses one existing board letter (the seed) and spends
    // hand tiles for the rest, so it can be at most hand_size + 1 long.
    int max_len = std::min(hand_size + 1, wu.longest_word_length);
    int start = wu.length_start[max_len];

    std::vector<int> written;

    for (int ei = start; ei < (int)wu.entries.size(); ei++)
    {
        const WordEntry& e = wu.entries[ei];

        // Cheap rejections first: unusable letters, then already-used words.
        if (e.mask & ~allowed_mask) continue;
        if (!accept_duplicates && used_words.find(e.word) != used_words.end()) continue;

        for (const auto& [seed_char, positions] : board_letters)
        {
            int seed_idx = wu.indexOf(seed_char);
            if (seed_idx < 0) continue;
            if (e.counts[seed_idx] == 0) continue;

            // Everything except one copy of the seed has to come from the hand.
            bool affordable = true;
            for (int i = 0; i < MAX_LETTERS; i++)
            {
                int need = e.counts[i] - (i == seed_idx ? 1 : 0);
                if (need > hand_counts[i]) { affordable = false; break; }
            }
            if (!affordable) continue;

            for (size_t p = 0; p < e.word.size(); p++)
            {
                if (e.word[p] != seed_char) continue;

                for (int cell : positions)
                {
                    int r = cell / width;
                    int c = cell % width;

                    for (int dir = 0; dir < 2; dir++)
                    {
                        bool horizontal = (dir == 0);
                        int row = horizontal ? r : r - (int)p;
                        int col = horizontal ? c - (int)p : c;

                        if (!tryPlace(e.word, row, col, horizontal, true, written))
                            continue;

                        // Spend exactly the tiles we actually laid down.
                        std::wstring spent;
                        for (int idx : written) spent += cells[idx];

                        std::wstring saved_tiles = hand.tiles;
                        auto saved_counts = hand_counts;
                        uint32_t saved_mask = hand_mask;

                        hand.removeWordFromTiles(spent);
                        hand_counts = {};
                        hand_mask = 0;
                        for (wchar_t ch : hand.tiles)
                        {
                            int li = wu.indexOf(ch);
                            if (li >= 0) { hand_counts[li]++; hand_mask |= (1u << li); }
                        }

                        bool inserted = false;
                        if (!accept_duplicates)
                            inserted = used_words.insert(e.word).second;

                        if (search()) return true;

                        // Undo everything this branch touched.
                        if (inserted) used_words.erase(e.word);
                        hand.tiles = saved_tiles;
                        hand_counts = saved_counts;
                        hand_mask = saved_mask;
                        for (int idx : written) cells[idx] = 0;

                        if (budget_exhausted) return false;
                    }
                }
            }
        }
    }

    return false;
}

bool Board::startSolver()
{
    if (!word_util_ptr) return false;

    hand.tiles = utils::toLower(hand.tiles);
    if (hand.tiles.length() > 144)
    {
        std::cerr << "Hand cannot contain more than 144 letters." << std::endl;
        return false;
    }
    if (hand.tiles.length() < 2) return false;

    const WordUtil& wu = *word_util_ptr;
    const std::wstring original_hand = hand.tiles;

    nodes = 0;
    budget_exhausted = false;
    deadline = std::chrono::steady_clock::now() + std::chrono::milliseconds(max_ms);

    hand_counts = {};
    hand_mask = 0;
    for (wchar_t ch : hand.tiles)
    {
        int li = wu.indexOf(ch);
        if (li >= 0) { hand_counts[li]++; hand_mask |= (1u << li); }
    }
    const auto base_counts = hand_counts;
    const uint32_t base_mask = hand_mask;

    resetGrid();

    const int hand_size = (int)hand.tiles.length();
    int max_len = std::min(hand_size, wu.longest_word_length);
    int start = wu.length_start[max_len];

    std::vector<int> written;

    // Try every seed word the hand can spell, longest first, and backtrack
    // into a different one if the rest of the hand can't be placed around it.
    for (int ei = start; ei < (int)wu.entries.size(); ei++)
    {
        const WordEntry& e = wu.entries[ei];

        if (e.mask & ~base_mask) continue;

        bool affordable = true;
        for (int i = 0; i < MAX_LETTERS; i++)
            if (e.counts[i] > base_counts[i]) { affordable = false; break; }
        if (!affordable) continue;

        int row = height / 2;
        int col = width / 2 - (int)e.word.length() / 2;

        if (!tryPlace(e.word, row, col, true, false, written)) continue;

        hand.tiles = original_hand;
        hand.removeWordFromTiles(e.word);
        hand_counts = base_counts;
        hand_mask = 0;
        for (int i = 0; i < MAX_LETTERS; i++) hand_counts[i] -= e.counts[i];
        for (int i = 0; i < MAX_LETTERS; i++) if (hand_counts[i]) hand_mask |= (1u << i);

        used_words.clear();
        if (!accept_duplicates) used_words.insert(e.word);

        if (hand.tiles.empty()) return true;   // single word used the whole hand
        if (search()) return true;

        // Undo and try the next seed word.
        for (int idx : written) cells[idx] = 0;
        used_words.clear();
        hand.tiles = original_hand;
        hand_counts = base_counts;
        hand_mask = base_mask;

        if (budget_exhausted) break;
    }

    hand.tiles = original_hand;
    return false;
}

std::vector<std::vector<std::string>> Board::getResultGrid() const
{
    int min_row = height, min_col = width, max_row = -1, max_col = -1;

    for (int r = 0; r < height; r++)
        for (int c = 0; c < width; c++)
            if (cells[r * width + c] != 0)
            {
                min_row = std::min(min_row, r);
                max_row = std::max(max_row, r);
                min_col = std::min(min_col, c);
                max_col = std::max(max_col, c);
            }

    if (max_row < 0) return {};

    std::vector<std::vector<std::string>> result;
    for (int r = min_row; r <= max_row; r++)
    {
        std::vector<std::string> row;
        for (int c = min_col; c <= max_col; c++)
        {
            wchar_t ch = cells[r * width + c];
            if (ch == 0) row.push_back("");
            else row.push_back(utils::wstringToString(utils::toUpper(std::wstring(1, ch))));
        }
        result.push_back(row);
    }

    return result;
}

#endif // SOLVER_H
