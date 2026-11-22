export function ProgressBar({ label, value }: { label: string; value?: number }) {
  return <progress className="ui-progress-bar" aria-label={label} max={100} value={value} />;
}
