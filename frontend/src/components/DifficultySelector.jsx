const DIFFICULTIES = ['Beginner', 'Intermediate', 'Advanced']

export default function DifficultySelector({ value, onChange }) {
  return (
    <label className="field">
      <span>Difficulty</span>
      <select value={value} onChange={(event) => onChange(event.target.value)}>
        {DIFFICULTIES.map((difficulty) => (
          <option key={difficulty} value={difficulty}>
            {difficulty}
          </option>
        ))}
      </select>
    </label>
  )
}
