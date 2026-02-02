export const ls = {
  get(key){ try { return JSON.parse(localStorage.getItem(key)); } catch { return null; } },
  set(key,val){ localStorage.setItem(key, JSON.stringify(val)); },
  del(key){ localStorage.removeItem(key); }
};
export function uid(len=12) {
  const s = Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2);
  return s.slice(0, len);
}
