import { Button } from './Button.jsx';

// Page controls that expose current position to assistive technology.
export function Pagination({ page, pages, onPage }) {
  return (
    <nav aria-label="Pagination" className="flex items-center justify-between gap-3">
      <Button disabled={page <= 1} onClick={() => onPage(page - 1)} variant="secondary">Previous</Button>
      <span aria-live="polite" className="text-sm text-slate-700">Page {page} of {pages}</span>
      <Button disabled={page >= pages} onClick={() => onPage(page + 1)} variant="secondary">Next</Button>
    </nav>
  );
}
