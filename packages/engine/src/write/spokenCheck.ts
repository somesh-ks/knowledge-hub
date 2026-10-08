/**
 * A cheap guard for the spoken version of a story. Grounding checks the summary against the source;
 * the spoken text is the same story retold, so it may not carry a number the summary and headline
 * do not already carry. Numbers are compared by value, so "$1,200", "1.2 thousand" and "twelve
 * hundred" all count as 1200, and a retelling can say "forty percent" for "40%".
 */

const UNITS: Record<string, number> = {
  zero: 0,
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
  eleven: 11,
  twelve: 12,
  thirteen: 13,
  fourteen: 14,
  fifteen: 15,
  sixteen: 16,
  seventeen: 17,
  eighteen: 18,
  nineteen: 19,
};

const TENS: Record<string, number> = {
  twenty: 20,
  thirty: 30,
  forty: 40,
  fifty: 50,
  sixty: 60,
  seventy: 70,
  eighty: 80,
  ninety: 90,
};

const SCALES: Record<string, number> = {
  thousand: 1e3,
  million: 1e6,
  billion: 1e9,
  trillion: 1e12,
};

/** Short forms written straight after a digit: "4K", "1.2M", "3bn". */
const SUFFIXES: Record<string, number> = { k: 1e3, m: 1e6, b: 1e9, bn: 1e9 };

const TOKEN = /\d[\d,]*(?:\.\d+)?(?:(?:bn|k|m|b)(?![a-z]))?|[a-z]+/g;
const DIGITS = /^(\d[\d,]*(?:\.\d+)?)(bn|k|m|b)?$/;

function isNumberWord(word: string | undefined): boolean {
  return (
    word !== undefined && (word in UNITS || word in TENS || word === "hundred" || word in SCALES)
  );
}

/** Every number in the text, as a value. Spelled-out numbers count; the lone word "one" does not. */
export function numberValues(text: string): Set<number> {
  const tokens = text.toLowerCase().match(TOKEN) ?? [];
  const values = new Set<number>();
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i] as string;
    const digits = DIGITS.exec(token);
    if (digits) {
      let value = Number.parseFloat((digits[1] as string).replace(/,/g, ""));
      if (digits[2]) value *= SUFFIXES[digits[2]] as number;
      const next = tokens[i + 1];
      const scale = next === undefined ? undefined : next === "hundred" ? 100 : SCALES[next];
      if (scale !== undefined) {
        value *= scale;
        i += 1;
      }
      // "3rd" and "4th": the suffix is not a number, and the digit is the number.
      values.add(value);
      continue;
    }
    if (!isNumberWord(token)) continue;

    // A run of number words: "twelve hundred", "a hundred and twenty", "two million".
    let total = 0;
    let current = 0;
    let words = 0;
    let j = i;
    while (j < tokens.length) {
      const word = tokens[j] as string;
      const unit = UNITS[word];
      const tens = TENS[word];
      const scale = SCALES[word];
      if (unit !== undefined) current += unit;
      else if (tens !== undefined) current += tens;
      else if (word === "hundred") current = (current === 0 ? 1 : current) * 100;
      else if (scale !== undefined) {
        total += (current === 0 ? 1 : current) * scale;
        current = 0;
      } else if (
        word === "and" &&
        words > 0 &&
        isNumberWord(tokens[j + 1]) &&
        (current >= 100 || total > 0)
      ) {
        // "a hundred and twenty": the "and" joins the parts of one number.
      } else break;
      words += 1;
      j += 1;
    }
    // The lone word "one" is a pronoun far more often than a figure.
    if (!(words === 1 && token === "one")) values.add(total + current);
    i = j - 1;
  }
  return values;
}

/** Numbers the spoken text states that none of the sources state. Empty means it is consistent. */
export function ungroundedNumbers(spoken: string, ...sources: readonly string[]): number[] {
  const known = new Set<number>();
  for (const source of sources) for (const value of numberValues(source)) known.add(value);
  return [...numberValues(spoken)].filter((value) => !known.has(value));
}

/** True when every number the spoken text states is in the headline or the summary. */
export function spokenIsGrounded(spoken: string, headline: string, summary: string): boolean {
  return ungroundedNumbers(spoken, headline, summary).length === 0;
}
