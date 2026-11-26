// Responsive horizontally scrollable table.
export function Table({ columns, rows, emptyMessage = 'No rows to display', emptyState, zebra = false, density = 'comfortable', responsive = false }) {
  if (!rows.length) {
    return emptyState ?? <p className="rounded-card border border-dashed border-slate-300 bg-white p-6 text-sm text-slate-600">{emptyMessage}</p>;
  }
  return (
    <div className="overflow-x-auto rounded-card border border-slate-200 bg-white">
      <table className={`min-w-full divide-y divide-slate-200 text-left text-sm ${responsive ? 'responsive-table' : ''}`}>
        <thead className="sticky top-0 z-10 bg-slate-50">
          <tr>
            {columns.map((column) => (
              <th className={`whitespace-nowrap px-4 ${density === 'compact' ? 'py-2' : 'py-3'} font-semibold text-slate-700 ${column.numeric ? 'text-right' : ''}`} key={column.key} scope="col">
                {column.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100 bg-white">
          {rows.map((row) => (
            <tr className={`${zebra ? 'even:bg-slate-50' : ''} hover:bg-brand-50/60`} key={
              row.id
              ?? row.key
              ?? row.itemId
              ?? row.customerId
              ?? row.runId
              ?? row.invoiceId
              ?? row.orderId
              ?? JSON.stringify(row)
            }>
              {columns.map((column) => (
                <td className={`whitespace-nowrap px-4 ${density === 'compact' ? 'py-2' : 'py-3'} text-slate-800 ${column.numeric ? 'text-right tabular-nums' : ''}`} key={column.key} data-label={column.label}>
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
