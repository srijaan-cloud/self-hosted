export const FIXED_TASKS = [
  { key: 'wake_ready', label: 'Wake up & get ready', time: '5:30 – 6:00 AM' },
  { key: 'reading', label: 'Reading', time: '6:00 – 7:30 AM' },
  { key: 'breakfast_prep', label: 'Breakfast & school prep', time: '7:30 – 8:15 AM' },
  { key: 'sleep', label: 'Sleep', time: 'by 9:00 PM' },
];

export const EXTRA_TASKS = [
  { key: 'homework', label: 'Homework' },
  { key: 'sports', label: 'Sports' },
  { key: 'play', label: 'Play' },
  { key: 'drawing', label: 'Drawing' },
  { key: 'painting', label: 'Painting' },
  { key: 'helping', label: 'Helping at home' },
];

export function computePoints(entry) {
  const fixed = FIXED_TASKS.filter((t) => entry[t.key]).length;
  const extra = EXTRA_TASKS.filter((t) => entry[t.key]).length;
  const bonus = fixed === FIXED_TASKS.length && extra >= 1 ? 2 : 0;
  return { fixed, extra, bonus, total: fixed + extra + bonus };
}
