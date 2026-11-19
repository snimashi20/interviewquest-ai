import { LEVELS } from '../data/interviewOptions'

// a simple dropdown for picking the difficulty
export default function DifficultySelector({ value, onChange }) {
  return (
    <label className="field">
      <span>Difficulty</span>
      <select value={value} onChange={(event) => onChange(event.target.value)}>
        {LEVELS.map((difficulty) => (
          <option key={difficulty} value={difficulty}>
            {difficulty}
          </option>
        ))}
      </select>
    </label>
  )
}
