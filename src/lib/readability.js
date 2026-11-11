// Flesch-Kincaid grade level. shortcut: vowel-group syllable heuristic (English only, +-1 grade);
// upgrade to a dictionary-based counter if the examiner starts rejecting borderline text.
export function countSyllables(word) {
  const w = word.toLowerCase().replace(/[^a-z]/g, '');
  if (!w) return 0;
  const groups = w.replace(/e$/, '').match(/[aeiouy]+/g);
  return Math.max(1, groups ? groups.length : 1);
}

export function fleschKincaidGrade(text) {
  const sentences = text.split(/[.!?]+/).map((s) => s.trim()).filter(Boolean);
  const words = text.match(/[A-Za-z']+/g) ?? [];
  if (!sentences.length || !words.length) return 0;
  const syllables = words.reduce((n, w) => n + countSyllables(w), 0);
  return 0.39 * (words.length / sentences.length) + 11.8 * (syllables / words.length) - 15.59;
}
