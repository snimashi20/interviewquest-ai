import { ROLE_GROUPS } from '../data/interviewOptions'

// a dropdown for picking the interview role. the roles are grouped (engineering, executive,
// IT operations, delivery, governance) because the flat list is far too long to scan otherwise.
export default function RoleSelector({ value, onChange }) {
  return (
    <label className="field">
      <span>Interview Role</span>
      <select value={value} onChange={(event) => onChange(event.target.value)}>
        {ROLE_GROUPS.map((group) => (
          <optgroup key={group.id} label={group.label}>
            {group.roles.map((role) => (
              <option key={role} value={role}>
                {role}
              </option>
            ))}
          </optgroup>
        ))}
      </select>
    </label>
  )
}
