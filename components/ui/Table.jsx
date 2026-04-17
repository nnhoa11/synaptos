"use client";

import { useState } from "react";

function classNames(...values) {
  return values.filter(Boolean).join(" ");
}

function compareValues(a, b) {
  if (a == null && b == null) {
    return 0;
  }
  if (a == null) {
    return 1;
  }
  if (b == null) {
    return -1;
  }
  if (typeof a === "number" && typeof b === "number") {
    return a - b;
  }
  return String(a).localeCompare(String(b), undefined, { numeric: true, sensitivity: "base" });
}

export default function Table({
  className = "",
  columns,
  emptyState = "No data available.",
  initialSort = null,
  onRowClick = null,
  rowClassName,
  rowKey = "id",
  rows,
}) {
  const [sortState, setSortState] = useState(initialSort);
  const sortedRows = [...rows];

  if (sortState?.key) {
    const column = columns.find((item) => item.key === sortState.key);
    const getter = column?.sortValue ?? ((row) => row?.[sortState.key]);

    sortedRows.sort((left, right) => {
      const comparison = compareValues(getter(left), getter(right));
      return sortState.direction === "desc" ? comparison * -1 : comparison;
    });
  }

  function toggleSort(key) {
    setSortState((current) => {
      if (!current || current.key !== key) {
        return { key, direction: "asc" };
      }

      if (current.direction === "asc") {
        return { key, direction: "desc" };
      }

      return null;
    });
  }

  return (
    <div className={classNames("ui-table-shell", className)}>
      {sortedRows.length ? (
        <table className="ui-table">
          <thead>
            <tr>
              {columns.map((column) => (
                <th key={column.key} style={column.width ? { width: column.width } : undefined}>
                  {column.sortable ? (
                    <button className="ui-table__sort" onClick={() => toggleSort(column.key)}>
                      <span>{column.label}</span>
                      <span>
                        {sortState?.key === column.key
                          ? sortState.direction === "asc"
                            ? "↑"
                            : "↓"
                          : "↕"}
                      </span>
                    </button>
                  ) : (
                    column.label
                  )}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {sortedRows.map((row, index) => {
              const key = typeof rowKey === "function" ? rowKey(row) : row?.[rowKey] ?? index;
              const rowClasses = typeof rowClassName === "function" ? rowClassName(row) : rowClassName;
              return (
                <tr
                  key={key}
                  className={rowClasses}
                  onClick={onRowClick ? () => onRowClick(row) : undefined}
                  style={onRowClick ? { cursor: "pointer" } : undefined}
                >
                  {columns.map((column) => (
                    <td key={column.key} style={column.align ? { textAlign: column.align } : undefined}>
                      {column.render ? column.render(row) : row?.[column.key]}
                    </td>
                  ))}
                </tr>
              );
            })}
          </tbody>
        </table>
      ) : (
        <div className="ui-table__empty">{emptyState}</div>
      )}
    </div>
  );
}
