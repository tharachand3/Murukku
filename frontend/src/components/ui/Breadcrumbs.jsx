import { Link } from 'react-router-dom';

export function Breadcrumbs({ items = [] }) {
  return <nav aria-label="Breadcrumb" className="mb-2 text-xs text-slate-500"><ol className="flex flex-wrap items-center gap-2">{items.map((item, index) => <li className="flex items-center gap-2" key={`${item.label}-${index}`}>{index > 0 && <span aria-hidden="true">/</span>}{item.to && index < items.length - 1 ? <Link className="hover:text-brand-700" to={item.to}>{item.label}</Link> : <span aria-current={index === items.length - 1 ? 'page' : undefined}>{item.label}</span>}</li>)}</ol></nav>;
}
