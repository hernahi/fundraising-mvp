export function calcTotal(arr, key) {
  return arr.reduce((sum, item) => sum + (Number(item[key]) || 0), 0);
}

export function calcAverage(arr, key) {
  if (!arr.length) return 0;
  return calcTotal(arr, key) / arr.length;
}

export function calcCountByStatus(arr, key = 'status') {
  return arr.reduce((acc, item) => {
    const value = item[key] || 'unknown';
    acc[value] = (acc[value] || 0) + 1;
    return acc;
  }, {});
}
