import time
import csv

# dictionary: https://kotus.fi/sanakirjat/kielitoimiston-sanakirja/nykysuomen-sana-aineistot/nykysuomen-sanalista/

def ConvertCSVToCommaDelimiter(inputFile, outputFile):
    # open input file with tab delimiter
    with open(inputFile, newline='') as csvfile:
        reader = csv.reader(csvfile, delimiter='\t') # the inputFile uses tab delimiter in this case
        # open output file with comma delimiter
        with open(outputFile, 'w', newline='') as outfile:
            writer = csv.writer(outfile, delimiter=',')
            # iterate through rows, write to output file with comma delimiter
            for row in reader:
                writer.writerow(row)
    
    print('CSV file converted to comma-delimited format.')

#ConvertCSVToCommaDelimiter('dictionary.csv', 'dict_comma.csv')





acceptPronouns = False
acceptNumerals = False

acceptSubstantives = True
acceptAdjectives = True
acceptVerbs = True

acceptCompoundWords = True

allowedCategories = []
if acceptSubstantives: allowedCategories.append('S')
if acceptAdjectives: allowedCategories.append('A')
if acceptVerbs: allowedCategories.append('V')


def IsWordValid(word, category, conjugation):
    # check if the word is a particle or some other bad category
    if 'P' in category or 'PV' in category or 'VP' in category:
        return False
    
    # check if the word is a pronoun
    if 'PR' in category and acceptPronouns:
        return True
    
    # check if the word is taipumaton or some other bad conjugation
    if '99' in conjugation or '100' in conjugation or '101' in conjugation:
        return False
    
    # check if the word is a numeral
    if category == 'N' and not acceptNumerals:
        return False
    
    # check if the word is a numeral
    if category == 'N' and not acceptNumerals:
        return False
    
    # check if the word is not in allowed category
    if not category in allowedCategories:
        return False
    
    # check if the word is a compound word
    if conjugation == '' and not acceptCompoundWords:
        return False

    return True



def ParseDictionary(inputFile, outputFile):
    startTime = time.time()
    print(f'Starting parsing {inputFile}...')
    
    with open(inputFile, newline='') as csvfile:
        reader = csv.reader(csvfile, delimiter=',')
        next(reader) # skip the header
        
        homonymRows = []
        homonymIndex = 1
        
        with open(outputFile, 'w', newline='') as wordlist:
            for row in reader:
                word = row[0]
                homonym = row[1] # homonyymi
                category = row[2] # sanaluokka
                conjugation = row[3] # taivutustiedot
                
                
                # check if the word consists of allowed characters in the finnish version of Bananagrams
                # TODO: if word has letter "-", check if its just yhdyssana jossa on kaksi vokaalia sanojen lopussa ja alussa (esim. rekka-auto) because we can allow the word REKKAAUTO in the game
                allowedChars = 'abdeghijklmnoprstuvyäö' # i think there is no c, f, q, w, x, z or å
                
                if not all(char in allowedChars for char in word):
                    continue
                
                # check that the word is makeable from the 144 characters in bananagrams
                charDistribution = {
                    'a': 16,
                    'b': 1,
                    'd': 1,
                    'e': 12,
                    'g': 1,
                    'h': 3,
                    'i': 15,
                    'j': 3,
                    'k': 8,
                    'l': 8,
                    'm': 5,
                    'n': 12,
                    'o': 8,
                    'p': 2,
                    'r': 3,
                    's': 11,
                    't': 14,
                    'u': 7,
                    'v': 4,
                    'y': 2,
                    'ä': 7,
                    'ö': 1
                }
                
                charDistributionExceeded = False;
                for c in word:
                    if word.count(c) > charDistribution[c]:
                        charDistributionExceeded = True
                        break
                    
                if charDistributionExceeded:
                    continue
                
                # handle homonyms
                if int(homonym if homonym else '0') != homonymIndex:
                    homonymIndex = 1 # reset the index
                    if homonymRows:
                        # if any of the homonyms also means a word in allowed category
                        for homonymRow in homonymRows:                            
                            if not IsWordValid(homonymRow[0], homonymRow[2], homonymRow[3]):
                                continue
                            
                            wordlist.write(f'{homonymRow[0].lower()}\n')
                            homonymRows.clear()
                            break
                
                if int(homonym if homonym else '0') == homonymIndex:
                    homonymRows.append(row)
                    homonymIndex += 1
                    continue
                
                
                if IsWordValid(word, category, conjugation):
                    if word == 'he':
                        print('saved he')
                    wordlist.write(f'{word.lower()}\n')
    
    endTime = time.time()
    
    # count the lines in the file
    with open(outputFile, 'rb') as f:
        lineCount = sum(1 for _ in f)
    
    print(f'Saved {lineCount} words to {outputFile} in {endTime - startTime:.4f}s')



ParseDictionary('dictionary.csv', 'wordlist.txt')