// src/utils/exportUtils.js
export function exportToCSV(rows, filename = 'export.csv') {
  if (!rows || !rows.length) return;

  const header = Object.keys(rows[0]).join(',');
  const body = rows
    .map(r =>
      Object.values(r)
        .map(v => `"${String(v).replace(/"/g, '""')}"`)
        .join(',')
    )
    .join('\n');

  const csv = `${header}\n${body}`;
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);

  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();

  URL.revokeObjectURL(url);
}
