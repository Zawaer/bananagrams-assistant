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
    WordUtil() : longestWordLength(1) {}
    WordUtil(const std::string& wordListFilename);

    std::wstring GetWordWithLength(const std::wstring& hand, int length);

    std::string wordListFilename;
    int longestWordLength;
    std::vector<std::wstring> words;
    std::unordered_map<std::wstring, std::vector<std::wstring>> anagrams;
    std::vector<std::pair<wchar_t, int>> letter_frequencies;
};

WordUtil::WordUtil(const std::string& wordListFilename) : wordListFilename(wordListFilename), longestWordLength(1)
{
    std::wifstream stream(wordListFilename);
    stream.imbue(std::locale(std::locale(), new std::codecvt_utf8<wchar_t>));
    std::wstring line;

    std::map<wchar_t, int> frequency_map;

    while (std::getline(stream, line))
    {
        // strip trailing whitespace (e.g. \r on linux reading windows files)
        while (!line.empty() && std::iswspace(line.back()))
            line.pop_back();

        if (line.empty()) continue;

        if ((int)line.length() > longestWordLength)
            longestWordLength = (int)line.length();

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

    std::cout << "Loaded " << words.size() << " words from " << wordListFilename << std::endl;
}

std::wstring WordUtil::GetWordWithLength(const std::wstring& hand, int length)
{
    for (const auto& [sortedWord, wordList] : anagrams)
    {
        for (const auto& word : wordList)
        {
            if ((int)word.length() != length) continue;

            bool canMakeWord = true;
            for (size_t i = 0; i < word.length(); i++)
            {
                wchar_t c = word[i];
                if (std::count(word.begin(), word.end(), c) > std::count(hand.begin(), hand.end(), c))
                {
                    canMakeWord = false;
                    break;
                }
            }

            if (canMakeWord)
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

    void RemoveWordFromTiles(const std::wstring& word)
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
    Board(WordUtil wordUtil, bool acceptDuplicates = false);

    void Reset();
    std::wstring GetTiles();
    bool PlaceFirstWord(int length);
    bool InsertWord(const std::wstring& word, int x, int y, bool isHorizontal, std::vector<int> seedXY);
    bool FindSpotForWord(const std::wstring& word, const wchar_t& seed);
    void RemoveWordFromWordlist(const std::wstring& word);

    bool StartSolver();
    bool Solver();

    // Returns the trimmed grid as a 2D vector of single-char strings (UTF-8), empty string for empty cells
    std::vector<std::vector<std::string>> GetResultGrid();

    std::vector<std::vector<std::wstring>> grid;
    Hand hand;
    WordUtil wordUtil;

private:
    int MAX_GRID_SIZE = 0;
    bool acceptDuplicates = false;
    std::vector<std::wstring> removedWords;
};

Board::Board(WordUtil wordUtil, bool acceptDuplicates)
    : wordUtil(wordUtil), acceptDuplicates(acceptDuplicates)
{
    Reset();
}

void Board::Reset()
{
    MAX_GRID_SIZE = (int)hand.tiles.length() * 2;
    if (MAX_GRID_SIZE < 10) MAX_GRID_SIZE = 10;

    grid.clear();
    for (int i = 0; i < MAX_GRID_SIZE; i++)
    {
        std::vector<std::wstring> row(MAX_GRID_SIZE, L"");
        grid.emplace_back(row);
    }

    // restore removed words
    for (const auto& word : removedWords)
    {
        wordUtil.words.emplace_back(word);
        wordUtil.anagrams[utils::sort(word)].emplace_back(word);
    }
    removedWords.clear();
}

std::wstring Board::GetTiles()
{
    std::wstring tiles;
    for (const auto& row : grid)
        for (const auto& tile : row)
            if (!tile.empty()) tiles += tile;
    return tiles;
}

bool Board::PlaceFirstWord(int length)
{
    std::wstring word = wordUtil.GetWordWithLength(hand.tiles, length);
    if (word.empty()) return false;

    int x = (int)(MAX_GRID_SIZE / 2 - word.length() / 2);
    int y = (int)(MAX_GRID_SIZE / 2);
    bool success = InsertWord(word, x, y, true, {-1, -1});
    if (!success) return false;

    RemoveWordFromWordlist(word);
    hand.RemoveWordFromTiles(word);
    return true;
}

bool Board::InsertWord(const std::wstring& word, int x, int y, bool isHorizontal, std::vector<int> seedXY)
{
    std::vector<std::vector<std::wstring>> newGrid = grid;

    if (isHorizontal)
    {
        for (int xIndex = x, i = 0; i < (int)word.size(); ++xIndex, ++i)
        {
            if (xIndex < 0 || xIndex >= MAX_GRID_SIZE || y < 1 || y >= MAX_GRID_SIZE - 1)
                return false;

            if (xIndex == seedXY[0] && y == seedXY[1])
            {
                if (xIndex + 1 < MAX_GRID_SIZE && !newGrid[y][xIndex + 1].empty())
                    return false;
                continue;
            }

            if (!newGrid[y][xIndex].empty())
                return false;

            newGrid[y][xIndex] = word[i];

            if (!newGrid[y - 1][xIndex].empty() || !newGrid[y + 1][xIndex].empty())
                return false;
        }
    }
    else
    {
        for (int yIndex = y, i = 0; i < (int)word.size(); ++yIndex, ++i)
        {
            if (yIndex < 1 || yIndex >= MAX_GRID_SIZE - 1 || x < 1 || x >= MAX_GRID_SIZE - 1)
                return false;

            if (x == seedXY[0] && yIndex == seedXY[1])
            {
                if (yIndex + 1 < MAX_GRID_SIZE && !newGrid[yIndex + 1][x].empty())
                    return false;
                continue;
            }

            if (!newGrid[yIndex][x].empty())
                return false;

            newGrid[yIndex][x] = word[i];

            if (!newGrid[y - 1][x].empty() || (y + (int)word.size() + 1 < MAX_GRID_SIZE && !newGrid[y + (int)word.size() + 1][x].empty()))
                return false;

            if (!newGrid[yIndex][x - 1].empty())
                return false;

            if (!newGrid[yIndex][x + 1].empty() && newGrid[yIndex][x - 1].empty() && (x + 2 < MAX_GRID_SIZE && newGrid[yIndex][x + 2].empty()))
                return false;
        }
    }

    grid = newGrid;
    return true;
}

void Board::RemoveWordFromWordlist(const std::wstring& word)
{
    if (acceptDuplicates) return;

    wordUtil.words.erase(std::remove(wordUtil.words.begin(), wordUtil.words.end(), word), wordUtil.words.end());

    std::wstring sortedWord = utils::sort(word);
    auto& anagramList = wordUtil.anagrams[sortedWord];
    anagramList.erase(std::remove(anagramList.begin(), anagramList.end(), word), anagramList.end());

    removedWords.emplace_back(word);
}

bool Board::FindSpotForWord(const std::wstring& word, const wchar_t& seed)
{
    if (seed == L' ') return false;

    if (!acceptDuplicates)
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
            int vY = row - (int)word.find(seed);
            if (InsertWord(word, col, vY, false, { col, row }))
            {
                RemoveWordFromWordlist(word);
                return true;
            }

            // try horizontal
            int hX = col - (int)word.find(seed);
            if (InsertWord(word, hX, row, true, { col, row }))
            {
                RemoveWordFromWordlist(word);
                return true;
            }
        }
    }

    return false;
}

bool Board::StartSolver()
{
    if ((int)hand.tiles.length() > 144)
    {
        std::cerr << "Hand cannot contain more than 144 letters." << std::endl;
        return false;
    }

    std::wstring originalHand = hand.tiles;
    bool solutionFound = false;

    int firstWordLength = (int)hand.tiles.length() > wordUtil.longestWordLength
        ? wordUtil.longestWordLength
        : (int)hand.tiles.length();

    for (; firstWordLength > 1; --firstWordLength)
    {
        hand.tiles = originalHand;
        Reset();

        if (!PlaceFirstWord(firstWordLength)) continue;

        if (Solver() || hand.tiles.empty())
        {
            solutionFound = true;
            break;
        }
    }

    return solutionFound;
}

bool Board::Solver()
{
    for (int wordLength = (int)hand.tiles.size() + 1; wordLength > 1; --wordLength)
    {
        std::wstring boardTiles = GetTiles();
        for (const wchar_t& tile : boardTiles)
        {
            std::wstring word = wordUtil.GetWordWithLength(hand.tiles + tile, wordLength);
            if (word.empty()) continue;

            if (!FindSpotForWord(word, tile)) continue;

            auto tilePos = word.find(tile);
            if (tilePos == std::wstring::npos) continue;

            hand.RemoveWordFromTiles(word.replace(tilePos, 1, L""));

            if (Solver() || hand.tiles.empty())
                return true;
        }
    }

    return false;
}

std::vector<std::vector<std::string>> Board::GetResultGrid()
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
