// Shows instantly during navigation while the page's data loads on the server,
// so the app never feels blank/frozen on a slow connection.
export default function Loading() {
  return (
    <div className="card" aria-busy="true">
      <p className="meta">Loading…</p>
    </div>
  );
}
