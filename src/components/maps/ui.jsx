/* Small shared building blocks for the /maps UI. */

export function MapsIcon({ children, filled = false, className = '' }) {
  return (
    <span
      className={`material-symbols-outlined${filled ? ' maps-icon--filled' : ''}${className ? ` ${className}` : ''}`}
      aria-hidden="true"
    >
      {children}
    </span>
  )
}

export function MapsIconButton({ icon, label, onClick, active = false, filled = false, danger = false, disabled = false, className = '', ...rest }) {
  return (
    <button
      type="button"
      className={`maps-icon-btn${active ? ' maps-icon-btn--active' : ''}${danger ? ' maps-icon-btn--danger' : ''}${className ? ` ${className}` : ''}`}
      onClick={onClick}
      aria-label={label}
      title={label}
      disabled={disabled}
      {...rest}
    >
      <MapsIcon filled={filled}>{icon}</MapsIcon>
    </button>
  )
}

export function MapsSpinner({ label }) {
  return (
    <span className="maps-spinner" role="status" aria-label={label}>
      <span className="maps-spinner__dot" />
    </span>
  )
}

export function ExternalLink({ href, children, className = '' }) {
  return (
    <a href={href} target="_blank" rel="noreferrer noopener" className={className}>
      {children}
    </a>
  )
}
