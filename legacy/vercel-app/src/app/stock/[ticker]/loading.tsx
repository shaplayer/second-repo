/** Shown instantly while a stock page gathers prices, financials and filings. */
export default function Loading() {
  return (
    <div style={{ paddingBlock: "24px 56px", display: "grid", gap: 16 }} aria-busy="true">
      <div className="skeleton" style={{ width: 120, height: 14 }} />
      <div className="skeleton" style={{ width: "min(420px, 80%)", height: 38 }} />
      <div className="skeleton" style={{ width: 180, height: 34 }} />
      <div className="two">
        <div className="skeleton" style={{ height: 300 }} />
        <div className="skeleton" style={{ height: 300 }} />
      </div>
      <p className="small muted" style={{ margin: 0 }}>
        Gathering prices, financials and SEC filings…
      </p>
    </div>
  );
}
