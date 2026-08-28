const ROLES = [
  'Software Engineering',
  'Backend Developer',
  'Frontend Developer',
  'Full Stack Developer',
  'Data Engineer',
  'DevOps Engineer',
  'Mobile Developer',
]

export default function RoleSelector({ value, onChange }) {
  return (
    <label className="field">
      <span>Interview Role</span>
      <select value={value} onChange={(event) => onChange(event.target.value)}>
        {ROLES.map((role) => (
          <option key={role} value={role}>
            {role}
          </option>
        ))}
      </select>
    </label>
  )
}
