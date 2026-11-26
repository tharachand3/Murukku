// Neutral surface for related content.
export function Card({ className = '', children, ...props }) {
  return (
    <section className={`rounded-card border border-slate-200 bg-white p-5 shadow-card ${className}`} {...props}>
      {children}
    </section>
  );
}

export function CardHeader({ className = '', children, ...props }) {
  return <header className={`border-b border-slate-100 px-5 py-4 ${className}`} {...props}>{children}</header>;
}

export function CardBody({ className = '', children, ...props }) {
  return <div className={`p-5 ${className}`} {...props}>{children}</div>;
}

export function CardFooter({ className = '', children, ...props }) {
  return <footer className={`border-t border-slate-100 px-5 py-4 ${className}`} {...props}>{children}</footer>;
}
