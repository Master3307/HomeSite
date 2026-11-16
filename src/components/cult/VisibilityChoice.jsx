/* Who sees a profile: everyone / members of the server (default) / only me. */

const VISIBILITY_OPTIONS = [
  { id: 'everyone', icon: 'public', label: 'Everyone', text: 'Anyone with the link, also people without an account.' },
  { id: 'members', icon: 'group', label: 'Members', text: 'Only logged-in members of the server. You are in the member list.' },
  { id: 'private', icon: 'lock', label: 'Only me', text: "Nobody else, not even members. You're not in the member list and never show as online." },
]

export default function VisibilityChoice({ value = 'members', onChange, disabled = false }) {
  return (
    <div className="visibility-choice" role="radiogroup" aria-label="Who can see your profile">
      {VISIBILITY_OPTIONS.map((option) => (
        <button key={option.id} type="button" role="radio" aria-checked={value === option.id} className={value === option.id ? 'is-active' : ''} disabled={disabled} onClick={() => onChange(option.id)}>
          <span className="material-symbols-outlined" aria-hidden="true">
            {option.icon}
          </span>
          <strong>{option.label}</strong>
          <small>{option.text}</small>
        </button>
      ))}
    </div>
  )
}
