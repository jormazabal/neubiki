import { useId } from "react";

export function SegmentedControl<Value extends string>({ label, options, value, onChange }: {
  label: string;
  options: readonly { value: Value; label: string }[];
  value: Value;
  onChange: (value: Value) => void;
}) {
  const group = useId();
  return <fieldset className="ui-segmented">
    <legend className="sr-only">{label}</legend>
    {options.map(option => <label key={option.value}>
      <input type="radio" className="sr-only" name={group} checked={value === option.value}
        onChange={() => onChange(option.value)} />
      <span>{option.label}</span>
    </label>)}
  </fieldset>;
}
