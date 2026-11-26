interface SegmentedProps<T extends string> {
  name: string
  labelledBy: string
  options: { value: T; label: string }[]
  value: T
  onChange: (value: T) => void
}

export function Segmented<T extends string>({
  name,
  labelledBy,
  options,
  value,
  onChange,
}: SegmentedProps<T>) {
  return (
    <div className="seg" role="radiogroup" aria-labelledby={labelledBy}>
      {options.map((option) => (
        <label key={option.value}>
          <input
            className="visually-hidden"
            type="radio"
            name={name}
            value={option.value}
            checked={value === option.value}
            onChange={() => {
              onChange(option.value)
            }}
          />
          {option.label}
        </label>
      ))}
    </div>
  )
}
