import { useMemo } from "react";
import { Info } from "lucide-react";

// Convert 0-based col index to Excel letter (A, B, ..., Z, AA, AB, ...)
function colLetter(idx) {
  let n = idx;
  let s = "";
  while (n >= 0) {
    s = String.fromCharCode(65 + (n % 26)) + s;
    n = Math.floor(n / 26) - 1;
  }
  return s;
}

function truncate(v, max = 24) {
  const s = v === null || v === undefined ? "" : String(v);
  return s.length > max ? s.slice(0, max) + "…" : s;
}

/**
 * Excel-like grid preview where user clicks the cell that contains the FIRST HEADER
 * of their data table. That sets headerRow (1-indexed) and firstCol (1-indexed).
 *
 * Props:
 *  - grid: array of arrays of cell values
 *  - headerRow (1-indexed)
 *  - firstCol (1-indexed)
 *  - onSelect({ headerRow, firstCol })
 */
export default function SheetGridPicker({ grid, headerRow, firstCol, onSelect }) {
  const cols = grid?.[0]?.length || 0;
  const rows = grid?.length || 0;

  const selectedRow = headerRow - 1;
  const selectedCol = firstCol - 1;

  const isInHeaderRow = (r) => r === selectedRow;
  const isInDataRegion = (r, c) => r >= selectedRow && c >= selectedCol;
  const isHeaderCell = (r, c) => r === selectedRow && c >= selectedCol;
  const isSelectedCell = (r, c) => r === selectedRow && c === selectedCol;

  const headerPreview = useMemo(() => {
    if (!grid || selectedRow >= rows) return [];
    return (grid[selectedRow] || []).slice(selectedCol).filter((v, i, arr) => {
      // trim trailing empties from preview label
      const rest = arr.slice(i);
      return rest.some((x) => x !== null && String(x ?? "").trim() !== "");
    });
  }, [grid, selectedRow, selectedCol, rows]);

  if (!grid || rows === 0) {
    return <div className="text-sm text-slate-500 p-4">Sin datos para mostrar.</div>;
  }

  return (
    <div className="space-y-2">
      <div className="flex items-start gap-2 text-xs text-slate-600 bg-blue-50 border border-blue-200 rounded-md p-2.5">
        <Info className="w-4 h-4 text-blue-600 shrink-0 mt-0.5" />
        <div>
          <p className="font-medium text-blue-900">Haz click en la celda que contiene el <strong>primer encabezado</strong> de tu tabla.</p>
          <p className="text-blue-800 mt-0.5">Todo lo que esté encima o a la izquierda se ignorará.</p>
        </div>
      </div>

      <div className="border border-slate-200 rounded-lg overflow-hidden bg-white">
        <div className="w-full max-h-[380px] side-scroll">
          <div className="min-w-max">
            <table className="text-xs border-collapse" data-testid="sheet-grid">
              <thead>
                <tr>
                  <th className="sticky top-0 left-0 z-20 bg-slate-100 border border-slate-200 w-8 min-w-[32px] h-6 text-center font-mono text-[10px] text-slate-500"></th>
                  {Array.from({ length: cols }).map((_, c) => (
                    <th
                      key={c}
                      className={`sticky top-0 z-10 border border-slate-200 min-w-[80px] h-6 text-center font-mono text-[10px] font-medium ${
                        c >= selectedCol ? "bg-[#005FB8]/10 text-[#005FB8]" : "bg-slate-100 text-slate-500"
                      }`}
                    >
                      {colLetter(c)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {grid.map((row, r) => (
                  <tr key={r}>
                    <td className={`sticky left-0 z-10 border border-slate-200 min-w-[32px] text-center font-mono text-[10px] font-medium ${
                      r >= selectedRow ? "bg-[#005FB8]/10 text-[#005FB8]" : "bg-slate-100 text-slate-500"
                    }`}>
                      {r + 1}
                    </td>
                    {row.map((cell, c) => {
                      const inData = isInDataRegion(r, c);
                      const isHeader = isHeaderCell(r, c);
                      const isSel = isSelectedCell(r, c);
                      const empty = cell === null || cell === undefined || (typeof cell === "string" && cell.trim() === "");
                      return (
                        <td
                          key={c}
                          onClick={() => onSelect({ headerRow: r + 1, firstCol: c + 1 })}
                          className={`border border-slate-200 px-2 py-1 max-w-[160px] cursor-pointer transition-colors relative
                            ${isSel ? "ring-2 ring-inset ring-[#005FB8] bg-[#005FB8]/15 font-semibold" : ""}
                            ${isHeader && !isSel ? "bg-[#005FB8]/8 font-medium text-slate-900" : ""}
                            ${inData && !isHeader ? "bg-white text-slate-700" : ""}
                            ${!inData ? "bg-slate-50 text-slate-400" : ""}
                            ${empty && inData && !isHeader ? "text-slate-300" : ""}
                            hover:bg-[#005FB8]/20`}
                          title={cell !== null && cell !== undefined ? String(cell) : ""}
                          data-testid={`grid-cell-${r}-${c}`}
                        >
                          {truncate(cell)}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      <div className="flex items-center justify-between text-xs text-slate-500 px-1">
        <div>
          Seleccionado: <span className="font-mono font-medium text-[#005FB8]">{colLetter(selectedCol)}{selectedRow + 1}</span>
          {" · "}Encabezados detectados: <span className="font-semibold text-slate-900">{headerPreview.length}</span>
        </div>
        <div className="text-[10px] font-mono">Fila {selectedRow + 1}, Col {selectedCol + 1}</div>
      </div>

      {headerPreview.length > 0 && (
        <div className="text-xs text-slate-600 bg-slate-50 border border-slate-200 rounded-md p-2">
          <p className="text-[10px] uppercase tracking-wider text-slate-500 mb-1 font-semibold">Encabezados detectados</p>
          <div className="flex flex-wrap gap-1">
            {headerPreview.slice(0, 20).map((h, i) => (
              <span key={i} className="bg-white border border-slate-200 rounded px-1.5 py-0.5 text-[11px] font-mono">
                {truncate(h, 20)}
              </span>
            ))}
            {headerPreview.length > 20 && (
              <span className="text-slate-500 text-[10px] self-center">+{headerPreview.length - 20} más</span>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
