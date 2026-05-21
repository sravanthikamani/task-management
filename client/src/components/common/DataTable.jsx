const DataTable = ({ columns, rows, empty = 'No records found.', rowClassName, rowCellClassName }) => (
  <div className="overflow-hidden rounded-md border border-slate-200 bg-white shadow-sm">
    <div className="overflow-x-auto">
      <table className="min-w-full divide-y divide-slate-200 text-sm">
        <thead className="bg-slate-50">
          <tr>
            {columns.map((column) => (
              <th className="px-4 py-3 text-left font-bold text-slate-600" key={column.key}>{column.label}</th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {rows.length === 0 && (
            <tr>
              <td className="px-4 py-6 text-center text-slate-500" colSpan={columns.length}>{empty}</td>
            </tr>
          )}
          {rows.map((row, index) => (
            <tr className={`${rowClassName ? rowClassName(row, index) : ''} hover:bg-slate-50`} key={row._id || row.id || index}>
              {columns.map((column) => (
                <td className={`px-4 py-3 text-slate-700 ${rowCellClassName ? rowCellClassName(row, index, column) : ''}`} key={column.key}>
                  {column.render ? column.render(row) : row[column.key]}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  </div>
);

export default DataTable;
