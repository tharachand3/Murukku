// Neutral surface for related content.
export function Card({ className = '', children, ...props }) {
  return (
    <section className={`rounded-xl border border-slate-200 bg-white p-5 shadow-sm ${className}`} {...props}>
      {children}
    </section>
  );
}
