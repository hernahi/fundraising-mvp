// Shared CSV export utility (safe stringify)
export function exportToCSV(rows, filename='export.csv'){
  if(!rows || !rows.length) return;
  const header = Object.keys(rows[0]);
  const safe = (v) => {
    const s = String(v ?? '');
    return '"' + s.replace(/"/g, '""') + '"';
  };
  const body = rows.map(r => header.map(h => safe(r[h])).join(',')).join('\n');
  const csv = header.join(',') + '\n' + body;
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename; a.click();
  URL.revokeObjectURL(url);
}
