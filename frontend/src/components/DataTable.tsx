import type { ReactNode } from "react";
import { Button, EmptyState } from "./ui";
import { Icon } from "./Icon";

export interface Column<T> {
  key: string;
  header: string;
  numeric?: boolean;
  sortable?: boolean;
  width?: string;
  render: (row: T) => ReactNode;
  sortValue?: (row: T) => number | string;
  headerRender?: () => ReactNode;
}

interface DataTableProps<T> {
  columns: Column<T>[];
  rows: T[];
  rowKey: (row: T) => string;
  onRowClick?: (row: T) => void;
  selectedKey?: string | null;
  sortKey?: string;
  sortDir?: "asc" | "desc";
  onSort?: (key: string) => void;
  emptyTitle?: string;
  emptyDesc?: string;
  footer?: ReactNode;
  ariaLabel?: string;
}

export function DataTable<T>({
  columns,
  rows,
  rowKey,
  onRowClick,
  selectedKey,
  sortKey,
  sortDir = "desc",
  onSort,
  emptyTitle = "Nothing here yet",
  emptyDesc,
  footer,
  ariaLabel,
}: DataTableProps<T>) {
  if (rows.length === 0 && emptyTitle) {
    return (
      <EmptyState
        icon="search"
        title={emptyTitle}
        desc={emptyDesc}
      />
    );
  }
  return (
    <div className="table-wrap">
      <table className="data" aria-label={ariaLabel}>
        <thead>
          <tr>
            {columns.map((col) => {
              const sortable = col.sortable !== false && !!onSort;
              const active = sortKey === col.key;
              return (
                <th
                  key={col.key}
                  className={`${col.numeric ? "num" : ""} ${sortable ? "" : "no-sort"}`}
                  style={{ width: col.width }}
                  onClick={() => sortable && onSort?.(col.key)}
                  aria-sort={
                    active ? (sortDir === "asc" ? "ascending" : "descending") : undefined
                  }
                >
                  {col.headerRender ? (
                    col.headerRender()
                  ) : (
                    <span className={col.numeric ? "" : "row"} style={{ gap: 5 }}>
                      {col.header}
                      {active &&
                        (sortDir === "asc" ? (
                          <Icon name="chevron-down" size={12} style={{ transform: "rotate(180deg)" }} />
                        ) : (
                          <Icon name="chevron-down" size={12} />
                        ))}
                    </span>
                  )}
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const key = rowKey(row);
            return (
              <tr
                key={key}
                className={selectedKey === key ? "selected" : ""}
                onClick={() => onRowClick?.(row)}
                tabIndex={onRowClick ? 0 : undefined}
                onKeyDown={(e) => {
                  if (onRowClick && (e.key === "Enter" || e.key === " ")) {
                    e.preventDefault();
                    onRowClick(row);
                  }
                }}
                style={{ cursor: onRowClick ? "pointer" : undefined }}
              >
                {columns.map((col) => (
                  <td key={col.key} className={col.numeric ? "num" : ""}>
                    {col.render(row)}
                  </td>
                ))}
              </tr>
            );
          })}
        </tbody>
      </table>
      {footer}
    </div>
  );
}

export function Pager({
  page,
  pageSize,
  total,
  onPage,
}: {
  page: number;
  pageSize: number;
  total: number;
  onPage: (p: number) => void;
}) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  return (
    <div className="pager">
      <span>
        Showing{" "}
        <b className="num" style={{ color: "var(--text-secondary)" }}>
          {(page - 1) * pageSize + 1}–{Math.min(total, page * pageSize)}
        </b>{" "}
        of <b className="num">{total.toLocaleString("en-IN")}</b>
      </span>
      <span className="row" style={{ gap: 6 }}>
        <Button size="sm" disabled={page <= 1} onClick={() => onPage(page - 1)}>
          <Icon name="chevron-left" size={13} /> Prev
        </Button>
        <span className="num" style={{ padding: "0 4px" }}>
          {page} / {pages}
        </span>
        <Button size="sm" disabled={page >= pages} onClick={() => onPage(page + 1)}>
          Next <Icon name="chevron-right" size={13} />
        </Button>
      </span>
    </div>
  );
}
