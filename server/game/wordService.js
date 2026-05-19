const wordsByCategory = require("../data/words.json");

const DIFFICULTY_POINTS = {
  easy: 60,
  medium: 90,
  hard: 130
};

const allWords = Object.entries(wordsByCategory).flatMap(([category, difficulties]) =>
  Object.entries(difficulties).flatMap(([difficulty, words]) =>
    words.map((word) => ({
      id: `${category}:${difficulty}:${word}`,
      word,
      category,
      difficulty,
      basePoints: DIFFICULTY_POINTS[difficulty] || 80
    }))
  )
);

function shuffle(values) {
  return [...values].sort(() => Math.random() - 0.5);
}

function getWordChoices(count = 3) {
  return shuffle(allWords).slice(0, count);
}

function getRandomChoice(choices) {
  const pool = choices?.length ? choices : getWordChoices(3);
  return pool[Math.floor(Math.random() * pool.length)];
}

function maskWord(word, revealedIndices = new Set()) {
  return word
    .split("")
    .map((char, index) => {
      if (char === " ") return " / ";
      return revealedIndices.has(index) ? char.toUpperCase() : "_";
    })
    .join(" ");
}

function revealNextLetter(word, revealedIndices) {
  const candidates = word
    .split("")
    .map((char, index) => ({ char, index }))
    .filter(({ char, index }) => char !== " " && !revealedIndices.has(index));

  if (!candidates.length) return false;

  const next = candidates[Math.floor(Math.random() * candidates.length)];
  revealedIndices.add(next.index);
  return true;
}

module.exports = {
  getWordChoices,
  getRandomChoice,
  maskWord,
  revealNextLetter
};
