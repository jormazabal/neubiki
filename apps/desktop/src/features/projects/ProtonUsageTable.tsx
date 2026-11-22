import { ArrowDown, ArrowUp } from "lucide-react";
import { useState } from "react";
import { Button } from "../../components/ui/Button";

type UsageRow = {
  key: string;
  label: string;
  interactions: number;
  tokens: string;
  cost: string;
};

const count = new Intl.NumberFormat("es");

export function ProtonUsageTable({ firstColumn, rows, totals }: {
  firstColumn: string;
  rows: readonly UsageRow[];
  totals: UsageRow;
}) {
  const [descending, setDescending] = useState(true);
  const ordered = [...rows].sort((a, b) => (descending ? b.interactions - a.interactions : a.interactions - b.interactions)
    || a.label.localeCompare(b.label, "es"));
  const largest = Math.max(1, ...rows.map(row => row.interactions));
  return <div className="proton-usage-table" tabIndex={0} role="region" aria-label="Tabla de consumo de IA">
    <table>
      <thead>
        <tr>
          <th scope="col">{firstColumn}</th>
          <th scope="col" aria-sort={descending ? "descending" : "ascending"}>
            <Button variant="quiet" size="compact" onClick={() => setDescending(value => !value)}>
              Interacciones {descending ? <ArrowDown size={14} aria-hidden="true" /> : <ArrowUp size={14} aria-hidden="true" />}
            </Button>
          </th>
          <th scope="col">Tokens</th>
          <th scope="col">EUR disponible</th>
        </tr>
      </thead>
      <tbody>{ordered.map(row => <tr key={row.key}>
        <th scope="row">{row.label}</th>
        <td>
          {count.format(row.interactions)}
          <span className="proton-usage-bar" aria-hidden="true" style={{ width: `${100 * row.interactions / largest}%` }} />
        </td>
        <td>{row.tokens}</td>
        <td>{row.cost}</td>
      </tr>)}</tbody>
      <tfoot><tr>
        <th scope="row">{totals.label}</th>
        <td>{count.format(totals.interactions)}</td>
        <td>{totals.tokens}</td>
        <td>{totals.cost}</td>
      </tr></tfoot>
    </table>
  </div>;
}
