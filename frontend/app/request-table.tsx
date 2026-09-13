"use client";
import { Check, TriangleAlert, ChevronRight } from "lucide-react";
import { Log, num, stamp } from "@/lib/api";
import { Badge, Empty, Price } from "./ui";
export default function RequestTable({
  logs,
  onSelect,
  compact = false,
}: {
  logs: Log[];
  onSelect: (l: Log) => void;
  compact?: boolean;
}) {
  return logs.length ? (
    <div className="table-scroll">
      <table role="table" className="requests-table responsive-table">
        <thead>
          <tr>
            <th>Model / request</th>
            <th>Status</th>
            <th>Latency</th>
            {!compact && (
              <>
                <th>Tokens in / out</th>
                <th>Cost</th>
                <th>Attempts</th>
              </>
            )}
            <th>Time</th>
            <th>
              <span className="sr-only">Details</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {logs.map((log) => (
            <tr key={log.id} role="row" onClick={() => onSelect(log)}>
              <td className="request-identity" role="cell">
                <button
                  className="table-cell-button"
                  onClick={(event) => {
                    event.stopPropagation();
                    onSelect(log);
                  }}
                >
                  <strong>{log.resolved_model || log.requested_model}</strong>
                  <small>
                    {log.provider_name || "No provider"}
                    {log.attempts.length > 1 && (
                      <span className="fallback-label"> ↪ Fallback</span>
                    )}
                  </small>
                </button>
              </td>
              <td data-label="Status" role="cell">
                <Badge tone={log.status < 400 ? "green" : "amber"}>
                  {log.status < 400 ? (
                    <Check size={12} />
                  ) : (
                    <TriangleAlert size={12} />
                  )}{" "}
                  {log.status}
                </Badge>
              </td>
              <td className="mono" data-label="Latency" role="cell">
                {Math.round(log.latency_ms)} <span className="muted">ms</span>
              </td>
              {!compact && (
                <>
                  <td className="mono" data-label="Tokens in / out" role="cell">
                    {num(log.input_tokens)} / {num(log.output_tokens)}
                  </td>
                  <td data-label="Cost" role="cell">
                    <Price value={log.estimated_cost} />
                  </td>
                  <td data-label="Attempts" role="cell">
                    {log.attempts.length}
                  </td>
                </>
              )}
              <td className="muted request-time" data-label="Time" role="cell">
                {stamp(log.created_at)}
              </td>
              <td className="request-chevron" aria-hidden="true">
                <ChevronRight size={15} className="muted" />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  ) : (
    <Empty
      title="No requests yet"
      headingLevel={compact ? 3 : 2}
      text="Your gateway requests and routing history will appear here."
    />
  );
}
