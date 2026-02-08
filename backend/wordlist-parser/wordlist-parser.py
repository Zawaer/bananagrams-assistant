"""
Nykysuomen sanalista parser for Bananagrams
Converts Kotimaisten kielten keskus word list to a filtered format for Bananagrams game.

Source: https://kaino.kotus.fi/lataa/nykysuomensanalista2024.txt
License: Creative Commons Nimeä 4.0 Kansainvälinen (CC BY 4.0)
"""

import time
import csv
from typing import List, Tuple, Optional


# ============================================================================
# CONFIGURATION
# ============================================================================

# Word categories to include
ACCEPT_PRONOUNS = False         # pronominit (esim. sinä)
ACCEPT_INTERJECTIONS = False    # huudahdukset (esim. auts)
ACCEPT_NUMERALS = True         # numeraalit (esim. kolme)
ACCEPT_SUBSTANTIVES = True      # substantiivit (esim. tuoli)
ACCEPT_ADJECTIVES = True        # adjektiivit (esim. punainen)
ACCEPT_VERBS = True             # verbit (esim. juosta)
ACCEPT_COMPOUND_WORDS = True    # yhdyssanat (compound words without inflection info)

# Finnish Bananagrams character distribution (144 tiles total)
BANANAGRAMS_TILES = {
    'a': 16, 'b': 1, 'd': 1, 'e': 12, 'g': 1, 'h': 3,
    'i': 15, 'j': 3, 'k': 8, 'l': 8, 'm': 5, 'n': 12,
    'o': 8, 'p': 2, 'r': 3, 's': 11, 't': 14, 'u': 7,
    'v': 4, 'y': 2, 'ä': 7, 'ö': 1
}

ALLOWED_CHARS = set(BANANAGRAMS_TILES.keys())


# ============================================================================
# WORD VALIDATION
# ============================================================================

def contains_only_allowed_chars(word: str) -> bool:
    """Check if word contains only Finnish Bananagrams characters."""
    return all(char in ALLOWED_CHARS for char in word)


def fits_tile_distribution(word: str) -> bool:
    """Check if word can be made with available Bananagrams tiles."""
    for char in set(word):
        if word.count(char) > BANANAGRAMS_TILES[char]:
            return False
    return True


def is_valid_category(category: str, inflection: str) -> bool:
    """
    Determine if word category is acceptable based on configuration.
    
    Args:
        category: Sanaluokka (word class) from the word list
        inflection: Taivutustiedot (inflection info) from the word list
        
    Returns:
        True if the word should be included, False otherwise
    """
    # Reject particles (adverbs, prepositions, conjunctions, interjections when used as particles)
    # except when they have special conjugation that makes them standalone words
    particle_markers = ['adverbi', 'prepositio', 'postpositio', 'konjunktio', 'interjektio']
    if any(marker in category for marker in particle_markers):
        # Check combined forms like "adverbi + kieltoverbi"
        if '+' in category or 'kieltoverbi' in category:
            return False
        # Interjections are okay as standalone exclamations when enabled
        if category == 'interjektio':
            return ACCEPT_INTERJECTIONS
        # Other particles typically rejected
        return False
    
    # Handle pronouns
    if 'pronomini' in category:
        return ACCEPT_PRONOUNS
    
    # Handle numerals
    if category == 'numeraali':
        return ACCEPT_NUMERALS
    
    # Reject words with special inflection codes:
    # 100 = misspelled (correct spelling in dictionary article)
    # 101 = pronoun with irregular inflection
    if inflection in ['100', '101']:
        return False
    
    # Check main word categories
    if ACCEPT_SUBSTANTIVES and 'substantiivi' in category:
        return True
    if ACCEPT_ADJECTIVES and 'adjektiivi' in category:
        return True
    if ACCEPT_VERBS and 'verbi' in category:
        return True
    
    # Compound words (no inflection info) - based on base word
    if not inflection and ACCEPT_COMPOUND_WORDS:
        # Allow if it contains an accepted category
        return (ACCEPT_SUBSTANTIVES and 'substantiivi' in category) or \
               (ACCEPT_ADJECTIVES and 'adjektiivi' in category) or \
               (ACCEPT_VERBS and 'verbi' in category)
    
    return False


def is_word_valid(word: str, category: str, inflection: str) -> bool:
    """
    Comprehensive validation of a word for Bananagrams use.
    
    Args:
        word: The word to validate
        category: Sanaluokka (word class)
        inflection: Taivutustiedot (inflection info)
        
    Returns:
        True if word passes all validation checks
    """
    # Skip words with hyphens (compound words like "rekka-auto")
    # TODO: Could allow these if we strip hyphens when it's just vowel collision
    if '-' in word:
        return False
    
    # Check character validity
    if not contains_only_allowed_chars(word):
        return False
    
    # Check tile distribution
    if not fits_tile_distribution(word):
        return False
    
    # Check category validity
    if not is_valid_category(category, inflection):
        return False
    
    return True


# ============================================================================
# HOMONYM HANDLING
# ============================================================================

def process_homonym_group(homonym_rows: List[Tuple[str, str, str, str]]) -> Optional[str]:
    """
    Process a group of homonymous words and return the word if any variant is valid.
    
    Homonyms are words that are spelled the same but have different meanings/categories.
    If ANY of the homonym variants is in an accepted category, we include the word.
    
    Args:
        homonym_rows: List of (word, homonym_num, category, inflection) tuples
        
    Returns:
        The word in lowercase if valid, None otherwise
    """
    for word, _, category, inflection in homonym_rows:
        if is_valid_category(category, inflection):
            return word.lower()
    return None


# ============================================================================
# MAIN PARSING LOGIC
# ============================================================================

def parse_dictionary(input_file: str, output_file: str) -> None:
    """
    Parse the Nykysuomen sanalista and create a filtered word list for Bananagrams.
    
    Args:
        input_file: Path to the tab-delimited CSV file
        output_file: Path to write the filtered word list (one word per line)
    """
    start_time = time.time()
    print(f'Starting to parse {input_file}...')
    
    words_written = 0
    words_processed = 0
    homonym_buffer: List[Tuple[str, str, str, str]] = []
    last_word = None
    
    try:
        with open(input_file, 'r', encoding='utf-8') as csvfile:
            reader = csv.reader(csvfile, delimiter='\t')
            
            # Skip header row
            next(reader)
            
            with open(output_file, 'w', encoding='utf-8') as wordlist:
                for row in reader:
                    words_processed += 1
                    
                    # Handle rows with missing columns (pad with empty strings)
                    while len(row) < 4:
                        row.append('')
                    
                    word = row[0].strip()
                    homonym_num = row[1].strip()
                    category = row[2].strip()
                    inflection = row[3].strip()
                    
                    # Skip empty rows
                    if not word:
                        continue
                    
                    # Handle homonyms
                    if homonym_num:
                        # If we're starting a new homonym group, process the previous one
                        if homonym_buffer and word != last_word:
                            result = process_homonym_group(homonym_buffer)
                            if result:
                                wordlist.write(f'{result}\n')
                                words_written += 1
                            homonym_buffer = []
                        
                        # Add to current homonym group
                        homonym_buffer.append((word, homonym_num, category, inflection))
                        last_word = word
                        continue
                    
                    # Process any pending homonym group
                    if homonym_buffer:
                        result = process_homonym_group(homonym_buffer)
                        if result:
                            wordlist.write(f'{result}\n')
                            words_written += 1
                        homonym_buffer = []
                    
                    # Process regular word
                    if is_word_valid(word, category, inflection):
                        wordlist.write(f'{word.lower()}\n')
                        words_written += 1
                    
                    last_word = word
                
                # Process final homonym group if any
                if homonym_buffer:
                    result = process_homonym_group(homonym_buffer)
                    if result:
                        wordlist.write(f'{result}\n')
                        words_written += 1
        
        end_time = time.time()
        duration = end_time - start_time
        
        print(f'\nParsing complete!')
        print(f'Processed: {words_processed:,} words')
        print(f'Saved: {words_written:,} words to {output_file}')
        print(f'Time: {duration:.2f} seconds')
        
    except FileNotFoundError:
        print(f'Error: Could not find input file {input_file}')
        raise
    except Exception as e:
        print(f'Error during parsing: {e}')
        raise


# ============================================================================
# ENTRY POINT
# ============================================================================

if __name__ == '__main__':
    parse_dictionary('nykysuomensanalista2024.txt', 'wordlist.txt')
