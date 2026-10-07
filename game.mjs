export const SYMBOLS = {
  rainbow: { name: 'Rainbow', points: 2 },
  blueBrown: { name: 'Blue & brown', points: 1 },
  bluePink: { name: 'Blue & pink', points: 1 },
  yellowBlack: { name: 'Yellow & black', points: 1 },
};
export const REWARDS = [
  { id: 'juice', name: 'Free juice box', cost: 50, icon: '🧃' },
  { id: 'cash', name: '$100 cash', cost: 600, icon: '💵' },
  { id: 'playstation', name: '$10 PlayStation gift card', cost: 800, icon: '🎮' },
  { id: 'flames', name: 'Flames game ticket', cost: 1000, icon: '🏒' },
  { id: 'meal', name: 'Fast food meal', cost: 1000, icon: '🍔' },
  { id: 'movie', name: 'Movie ticket', cost: 1000, icon: '🎬' },
  { id: 'pizza', name: 'Free pizza', cost: 1500, icon: '🍕' },
  { id: 'merch', name: 'Exclusive merch', cost: 1500, icon: '👕' },
];
export function scoreFlaps(flaps) {
  if (!Array.isArray(flaps) || flaps.length < 1 || flaps.length > 2 || flaps.some(x => !Object.hasOwn(SYMBOLS, x))) throw new Error('Choose one or two valid symbols.');
  const double = flaps.length === 2 && flaps[0] === flaps[1];
  return { points: double ? 100 : flaps.reduce((sum, x) => sum + SYMBOLS[x].points, 0), double };
}
