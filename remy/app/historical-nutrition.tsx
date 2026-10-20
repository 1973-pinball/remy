"use client";

import { useMemo } from "react";
import { BookOpen, CalendarDays } from "lucide-react";
import { ofKind, round, summarize, type Entry, type HistoricalDailySummary } from "@/lib/domain";
import { etlFields } from "./forms";

const display = (value: number | null | undefined, unit = "") =>
  value == null ? "—" : `${round(value).toLocaleString()}${unit ? ` ${unit}` : ""}`;

export function HistoricalSummaryNotice({
  entry,
  active,
}: {
  entry: Entry<HistoricalDailySummary>;
  active: boolean;
}) {
  return (
    <section className="historical-summary-notice" aria-label="Historical nutrition source">
      <BookOpen size={18} />
      <div>
        <strong>{active ? "Daily totals from your historical REMY summary" : "Historical summary retained for reference"}</strong>
        <p>
          {active
            ? `The numbers for ${entry.localDate} come from an imported daily estimate. Individual meals and food-log coverage are unknown.`
            : "Saved meal entries supply the daily totals for this date. The historical summary is kept separately and is never added to those meals."}
        </p>
        {active && <p>Adding meal details switches the entire date to totals from those saved meals.</p>}
        <details>
          <summary>Source notes</summary>
          <p className="historical-source-notes">{entry.data.notes || "No additional source notes."}</p>
          <small>Source message: {entry.data.sourceMessageId}</small>
        </details>
      </div>
    </section>
  );
}

export function HistoricalNutritionTable({
  records,
  selectedDate,
  onOpenDate,
}: {
  records: Entry[];
  selectedDate: string;
  onOpenDate: (date: string) => void;
}) {
  const summaries = useMemo(() => ofKind<HistoricalDailySummary>(records, "dailySummary")
    .filter((entry) => !!entry.localDate)
    .sort((a, b) => b.localDate!.localeCompare(a.localDate!) || b.updatedAt.localeCompare(a.updatedAt)), [records]);
  const daySources = useMemo(() => new Map([...new Set(summaries.map((entry) => entry.localDate!))]
    .map((date) => [date, summarize(records, date)])), [records, summaries]);
  if (!summaries.length) return null;
  return (
    <section className="card historical-history">
      <div className="section-heading">
        <h2><CalendarDays size={18} /> Daily history from REMY</h2>
        <span>{summaries.length} historical {summaries.length === 1 ? "summary" : "summaries"}</span>
      </div>
      <p className="muted">
        These are source daily estimates with unknown logging coverage. Open a date to see its current totals.
        Any saved meals take precedence over the full historical summary for that date.
      </p>
      <div className="historical-table-scroll" role="region" aria-label="Historical daily nutrition summaries" tabIndex={0}>
        <table className="historical-table">
          <thead>
            <tr>
              <th scope="col">Date</th>
              <th scope="col">Energy</th>
              <th scope="col">Protein</th>
              <th scope="col">Carbs</th>
              <th scope="col">Fat</th>
              <th scope="col">Fiber</th>
              <th scope="col">Use & source</th>
            </tr>
          </thead>
          <tbody>
            {summaries.map((entry) => {
              const summary = daySources.get(entry.localDate!)!;
              const active = summary.nutritionSource === "historical-summary" && summary.historicalSummary?.id === entry.id;
              return (
                <tr key={entry.id} id={entry.id} className={entry.localDate === selectedDate ? "selected" : undefined}>
                  <th scope="row">
                    <a href={`/?view=Food&date=${entry.localDate}`}
                      onClick={(event) => { event.preventDefault(); onOpenDate(entry.localDate!); }}>
                      {entry.localDate}
                    </a>
                    <small>Coverage unknown</small>
                  </th>
                  <td>{display(entry.data.calories, "kcal")}</td>
                  <td>{display(entry.data.protein, "g")}</td>
                  <td>{display(entry.data.carbs, "g")}</td>
                  <td>{display(entry.data.fat, "g")}</td>
                  <td>{display(entry.data.fiber, "g")}</td>
                  <td className="historical-table-source">
                    <span>{active ? "Used for this date" : summary.meals.length ? "Meal entries take precedence" : "Reference only"}</span>
                    <details>
                      <summary>Notes & food groups</summary>
                      <p className="historical-source-notes">{entry.data.notes || "No additional source notes."}</p>
                      <dl>{etlFields.map(([key, label, unit]) => (
                        <div key={key}><dt>{label}</dt><dd>{display(entry.data.etl?.[key], unit)}</dd></div>
                      ))}</dl>
                      <small>Source message: {entry.data.sourceMessageId}</small>
                    </details>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="microcopy">A dash means the source did not provide a value. These summaries remain separate from meal records and do not establish a complete food day.</p>
    </section>
  );
}
