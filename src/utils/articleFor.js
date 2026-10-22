// "a" or "an" before a word, by its first letter: the right panel's "Is a(n)".
export const getArticleFor = (word) => {
  const firstLetter = word?.trim()[0]?.toLowerCase();
  return ['a', 'e', 'i', 'o', 'u'].includes(firstLetter) ? 'an' : 'a';
};
