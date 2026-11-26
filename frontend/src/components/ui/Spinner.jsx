// Accessible compact loading indicator.
export function Spinner({ label = 'Loading', small = false }) {
  return (
    <span
      aria-label={label}
      className={`inline-block animate-spin rounded-full border-2 border-current border-r-transparent ${
        small ? 'h-4 w-4' : 'h-8 w-8'
      }`}
      role="status"
    />
  );
}
