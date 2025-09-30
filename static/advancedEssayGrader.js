// advancedEssayGrader.js

function tokenize(text) {
  return text
    .toLowerCase()
    .replace(/[.,\/#!$%\^&\*;:{}=\-_`~()]/g, "")
    .split(/\s+/)
    .filter(Boolean);
}

function ngrams(tokens, n = 1) {
  const arr = [];
  for (let i = 0; i <= tokens.length - n; i++) {
    arr.push(tokens.slice(i, i + n).join(" "));
  }
  return arr;
}

function bagOfWordsWeighted(tokens) {
  const bag = {};
  for (let n = 1; n <= 3; n++) {
    const grams = ngrams(tokens, n);
    for (const gram of grams) {
      // Trọng số n-gram dài hơn cao hơn
      const weight = n;
      bag[gram] = (bag[gram] || 0) + weight;
    }
  }
  return bag;
}

function cosineSimilarityBag(bagA, bagB) {
  const allKeys = new Set([...Object.keys(bagA), ...Object.keys(bagB)]);
  let dot = 0, normA = 0, normB = 0;
  for (const key of allKeys) {
    const a = bagA[key] || 0;
    const b = bagB[key] || 0;
    dot += a * b;
    normA += a * a;
    normB += b * b;
  }
  if (normA === 0 || normB === 0) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

export function gradeEssayAdvanced(userAnswer, keyAnswer) {
  const userText = userAnswer ? userAnswer.trim() : "";
  const keyText = keyAnswer ? keyAnswer.trim() : "";

  let score = 0;
  if (userText && keyText) {
    const userBag = bagOfWordsWeighted(tokenize(userText));
    const keyBag = bagOfWordsWeighted(tokenize(keyText));
    const similarity = cosineSimilarityBag(userBag, keyBag);

    if (similarity === 0) score = 0;
    else if (similarity >= 0.8) score = 1;
    else if (similarity >= 0.75) score = 0.75;
    else if (similarity >= 0.5) score = 0.5;
    else if (similarity >= 0.25) score = 0.25;
    else score = 0;
  }

  return {
    score,
    selectedContent: userText || "(chưa trả lời)",
    correctContent: keyText || "",
    isCorrect: score >= 0.25,
  };
}
