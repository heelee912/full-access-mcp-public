export interface TextReplacement {
  search: string;
  replace: string;
  expectedCount?: number;
}

export interface TextReplacementResult {
  updatedText: string;
  totalReplacementCount: number;
  appliedReplacements: Array<{
    search: string;
    replace: string;
    replacementCount: number;
  }>;
}

function countLiteralMatches(source: string, search: string): number {
  if (search.length === 0) {
    return 0;
  }

  let count = 0;
  let cursor = 0;

  while (true) {
    const matchIndex = source.indexOf(search, cursor);
    if (matchIndex === -1) {
      return count;
    }

    count += 1;
    cursor = matchIndex + search.length;
  }
}

export function applyTextReplacements(
  source: string,
  replacements: TextReplacement[],
): TextReplacementResult {
  let updatedText = source;
  let totalReplacementCount = 0;

  const appliedReplacements = replacements.map((replacement) => {
    if (replacement.search.length === 0) {
      throw new Error('search must not be empty');
    }

    const replacementCount = countLiteralMatches(updatedText, replacement.search);

    if (replacement.expectedCount !== undefined) {
      if (replacementCount !== replacement.expectedCount) {
        throw new Error(
          `expected ${replacement.expectedCount} matches for "${replacement.search}", found ${replacementCount}`,
        );
      }
    } else if (replacementCount === 0) {
      throw new Error(`no matches found for "${replacement.search}"`);
    }

    updatedText = updatedText.split(replacement.search).join(replacement.replace);
    totalReplacementCount += replacementCount;

    return {
      search: replacement.search,
      replace: replacement.replace,
      replacementCount,
    };
  });

  return {
    updatedText,
    totalReplacementCount,
    appliedReplacements,
  };
}
