export async function asyncMap(array, fn) {
  return Promise.all(array.map(fn));
}
export async function asyncFilter(array, fn) {
  const flags = await Promise.all(array.map(fn));
  return array.filter((_, i) => flags[i]);
}
export async function asyncSome(array, fn) {
  for (let i = 0; i < array.length; i++) if (await fn(array[i], i, array)) return true;
  return false;
}
export async function asyncFind(array, fn) {
  for (let i = 0; i < array.length; i++) if (await fn(array[i], i, array)) return array[i];
}
export async function asyncForEach(array, fn) {
  for (let i = 0; i < array.length; i++) await fn(array[i], i, array);
}
