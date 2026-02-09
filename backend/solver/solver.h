#ifndef SOLVER_H
#define SOLVER_H

#include <vector>
#include <string>
#include <algorithm>
#include <unordered_map>
#include <map>
#include <fstream>
#include <iostream>
#include <codecvt>
#include <locale>
#include <cwctype>

#include "utils.h"

// ============================================================================
// WordUtil - loads and manages the word list
// ============================================================================

class WordUtil
{
public:
    WordUtil() : longest_word_length(1) {}
    WordUtil(const std::string& word_list_filename);

    std::wstring getWordWithLength(const std::wstring& hand, int length);

    std::string word_list_filename;
    int longest_word_length;
    std::vector<std::wstring> words;
    std::unordered_map<std::wstring, std::vector<std::wstring>> anagrams;
    std::vector<std::pair<wchar_t, int>> letter_frequencies;
};

WordUtil::WordUtil(const std::string& word_list_filename) : word_list_filename(word_list_filename), longest_word_length(1)
{
    // Check if file exists
    std::wifstream stream(word_list_filename);
    if (!stream.is_open() || !stream.good()) {
        std::cerr << "Error: Could not open wordlist file: " << word_list_filename << std::endl;
        throw std::runtime_error("Failed to load wordlist: " + word_list_filename);
    }
    
    stream.imbue(std::locale(std::locale(), new std::codecvt_utf8<wchar_t>));
    std::wstring line;

    std::map<wchar_t, int> frequency_map;

    while (std::getline(stream, line))
    {
        // strip trailing whitespace (e.g. \r on linux reading windows files)
        while (!line.empty() && std::iswspace(line.back()))
            line.pop_back();

        if (line.empty()) continue;

        if ((int)line.length() > longest_word_length)
            longest_word_length = (int)line.length();

        words.emplace_back(line);
        anagrams[utils::sort(line)].emplace_back(line);

        for (wchar_t letter : line)
        {
            if (!std::iswspace(letter))
                frequency_map[letter]++;
        }
    }

    letter_frequencies = std::vector<std::pair<wchar_t, int>>(frequency_map.begin(), frequency_map.end());
    std::sort(letter_frequencies.begin(), letter_frequencies.end(),
        [](const std::pair<wchar_t, int>& a, const std::pair<wchar_t, int>& b) {
            return a.second < b.second;
        });

    std::cout << "Loaded " << words.size() << " words from " << word_list_filename << std::endl;
}

std::wstring WordUtil::getWordWithLength(const std::wstring& hand, int length)
{
    for (const auto& [sorted_word, word_list] : anagrams)
    {
        for (const auto& word : word_list)
        {
            if ((int)word.length() != length) continue;

            bool can_make_word = true;
            for (size_t i = 0; i < word.length(); i++)
            {
                wchar_t c = word[i];
                if (std::count(word.begin(), word.end(), c) > std::count(hand.begin(), hand.end(), c))
                {
                    can_make_word = false;
                    break;
                }
            }

            if (can_make_word)
                return word;
        }
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
    Hand(const std::wstring& tiles) : tiles(utils::tolower(tiles)) {}

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
// Board - the game board and solver
// ============================================================================

class Board
{
public:
    Board() {}
    Board(WordUtil wordUtil, bool accept_duplicates = false);

    void reset();
    std::wstring getTiles();
    bool placeFirstWord(int length);
    bool insertWord(const std::wstring& word, int x, int y, bool is_horizontal, std::vector<int> seed_xy);
    bool findSpotForWord(const std::wstring& word, const wchar_t& seed);
    void removeWordFromWordlist(const std::wstring& word);

    bool startSolver();
    bool solver();

    // Returns the trimmed grid as a 2D vector of single-char strings (UTF-8), empty string for empty cells
    std::vector<std::vector<std::string>> getResultGrid();

    std::vector<std::vector<std::wstring>> grid;
    Hand hand;
    WordUtil wordUtil;

private:
    int max_grid_size = 0;
    bool accept_duplicates = false;
    std::vector<std::wstring> removed_words;
};

Board::Board(WordUtil wordUtil, bool accept_duplicates)
    : wordUtil(wordUtil), accept_duplicates(accept_duplicates)
{
    reset();
}

void Board::reset()
{
    max_grid_size = (int)hand.tiles.length() * 2;
    if (max_grid_size < 10) max_grid_size = 10;

    grid.clear();
    for (int i = 0; i < max_grid_size; i++)
    {
        std::vector<std::wstring> row(max_grid_size, L"");
        grid.emplace_back(row);
    }

    // restore removed words
    for (const auto& word : removed_words)
    {
        wordUtil.words.emplace_back(word);
        wordUtil.anagrams[utils::sort(word)].emplace_back(word);
    }
    removed_words.clear();
}

std::wstring Board::getTiles()
{
    std::wstring tiles;
    for (const auto& row : grid)
        for (const auto& tile : row)
            if (!tile.empty()) tiles += tile;
    return tiles;
}

bool Board::placeFirstWord(int length)
{
    std::wstring word = wordUtil.getWordWithLength(hand.tiles, length);
    if (word.empty()) return false;

    int x = (int)(max_grid_size / 2 - word.length() / 2);
    int y = (int)(max_grid_size / 2);
    bool success = insertWord(word, x, y, true, {-1, -1});
    if (!success) return false;

    removeWordFromWordlist(word);
    hand.removeWordFromTiles(word);
    return true;
}

bool Board::insertWord(const std::wstring& word, int x, int y, bool is_horizontal, std::vector<int> seed_xy)
{
    std::vector<std::vector<std::wstring>> new_grid = grid;

    if (is_horizontal)
    {
        for (int x_index = x, i = 0; i < (int)word.size(); ++x_index, ++i)
        {
            if (x_index < 0 || x_index >= max_grid_size || y < 1 || y >= max_grid_size - 1)
                return false;

            if (x_index == seed_xy[0] && y == seed_xy[1])
            {
                if (x_index + 1 < max_grid_size && !new_grid[y][x_index + 1].empty())
                    return false;
                continue;
            }

            if (!new_grid[y][x_index].empty())
                return false;

            new_grid[y][x_index] = word[i];

            if (!new_grid[y - 1][x_index].empty() || !new_grid[y + 1][x_index].empty())
                return false;
        }
    }
    else
    {
        for (int y_index = y, i = 0; i < (int)word.size(); ++y_index, ++i)
        {
            if (y_index < 1 || y_index >= max_grid_size - 1 || x < 1 || x >= max_grid_size - 1)
                return false;

            if (x == seed_xy[0] && y_index == seed_xy[1])
            {
                if (y_index + 1 < max_grid_size && !new_grid[y_index + 1][x].empty())
                    return false;
                continue;
            }

            if (!new_grid[y_index][x].empty())
                return false;

            new_grid[y_index][x] = word[i];

            if (!new_grid[y - 1][x].empty() || (y + (int)word.size() + 1 < max_grid_size && !new_grid[y + (int)word.size() + 1][x].empty()))
                return false;

            if (!new_grid[y_index][x - 1].empty())
                return false;

            if (!new_grid[y_index][x + 1].empty() && new_grid[y_index][x - 1].empty() && (x + 2 < max_grid_size && new_grid[y_index][x + 2].empty()))
                return false;
        }
    }

    grid = new_grid;
    return true;
}

void Board::removeWordFromWordlist(const std::wstring& word)
{
    if (accept_duplicates) return;

    wordUtil.words.erase(std::remove(wordUtil.words.begin(), wordUtil.words.end(), word), wordUtil.words.end());

    std::wstring sorted_word = utils::sort(word);
    auto& anagram_list = wordUtil.anagrams[sorted_word];
    anagram_list.erase(std::remove(anagram_list.begin(), anagram_list.end(), word), anagram_list.end());

    removed_words.emplace_back(word);
}

bool Board::findSpotForWord(const std::wstring& word, const wchar_t& seed)
{
    if (seed == L' ') return false;

    if (!accept_duplicates)
    {
        if (std::find(wordUtil.words.begin(), wordUtil.words.end(), word) == wordUtil.words.end())
            return false;
    }

    for (int row = 0; row < (int)grid.size(); ++row)
    {
        for (int col = 0; col < (int)grid[row].size(); ++col)
        {
            if (grid[row][col].empty()) continue;
            if (seed != grid[row][col][0]) continue;

            // try vertical
            int v_y = row - (int)word.find(seed);
            if (insertWord(word, col, v_y, false, { col, row }))
            {
                removeWordFromWordlist(word);
                return true;
            }

            // try horizontal
            int h_x = col - (int)word.find(seed);
            if (insertWord(word, h_x, row, true, { col, row }))
            {
                removeWordFromWordlist(word);
                return true;
            }
        }
    }

    return false;
}

bool Board::startSolver()
{
    if ((int)hand.tiles.length() > 144)
    {
        std::cerr << "Hand cannot contain more than 144 letters." << std::endl;
        return false;
    }

    std::wstring original_hand = hand.tiles;
    bool solution_found = false;

    int first_word_length = (int)hand.tiles.length() > wordUtil.longest_word_length
        ? wordUtil.longest_word_length
        : (int)hand.tiles.length();

    for (; first_word_length > 1; --first_word_length)
    {
        hand.tiles = original_hand;
        reset();

        if (!placeFirstWord(first_word_length)) continue;

        if (solver() || hand.tiles.empty())
        {
            solution_found = true;
            break;
        }
    }

    return solution_found;
}

bool Board::solver()
{
    for (int word_length = (int)hand.tiles.size() + 1; word_length > 1; --word_length)
    {
        std::wstring board_tiles = getTiles();
        for (const wchar_t& tile : board_tiles)
        {
            std::wstring word = wordUtil.getWordWithLength(hand.tiles + tile, word_length);
            if (word.empty()) continue;

            if (!findSpotForWord(word, tile)) continue;

            auto tile_pos = word.find(tile);
            if (tile_pos == std::wstring::npos) continue;

            hand.removeWordFromTiles(word.replace(tile_pos, 1, L""));

            if (solver() || hand.tiles.empty())
                return true;
        }
    }

    return false;
}

std::vector<std::vector<std::string>> Board::getResultGrid()
{
    // Find boundaries
    int min_row = (int)grid.size(), min_col = (int)grid[0].size();
    int max_row = -1, max_col = -1;

    for (int r = 0; r < (int)grid.size(); ++r)
    {
        for (int c = 0; c < (int)grid[r].size(); ++c)
        {
            if (!grid[r][c].empty())
            {
                min_row = std::min(min_row, r);
                max_row = std::max(max_row, r);
                min_col = std::min(min_col, c);
                max_col = std::max(max_col, c);
            }
        }
    }

    if (max_row < 0) return {}; // empty board

    std::vector<std::vector<std::string>> result;
    for (int r = min_row; r <= max_row; ++r)
    {
        std::vector<std::string> row;
        for (int c = min_col; c <= max_col; ++c)
        {
            if (grid[r][c].empty())
                row.push_back("");
            else
                row.push_back(utils::wstring2string(utils::toupper(grid[r][c])));
        }
        result.push_back(row);
    }

    return result;
}

#endif // SOLVER_H
