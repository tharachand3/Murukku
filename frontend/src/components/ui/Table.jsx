// Responsive horizontally scrollable table.
export function Table({ columns, rows, emptyMessage = 'No rows to display' }) {
  if (!rows.length) {
    return <p className="rounded-lg bg-slate-50 p-4 text-sm text-slate-600">{emptyMessage}</p>;
  }
  return (
    <div className="overflow-x-auto rounded-lg border border-slate-200">
      <table className="min-w-full divide-y divide-slate-200 text-left text-sm">
        <thead className="bg-slate-50">
          <tr>
            {columns.map((column) => (
              <th className="whitespace-nowrap px-4 py-3 font-semibold text-slate-700" key={column.key} scope="col">
                {column.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100 bg-white">
          {rows.map((row, rowIndex) => (
            <tr key={row.id ?? row.key ?? rowIndex}>
              {columns.map((column) => (
                <td className="whitespace-nowrap px-4 py-3 text-slate-800" key={column.key}>
                  {column.render ? column.render(row) : row[column.key]}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
