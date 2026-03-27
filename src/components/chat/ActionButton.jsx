export default function ActionButton({ label, onClick, disabled = false }) {
  return (
    <div style={{ textAlign: 'center', margin: '8px 0' }}>
      <button
        className="primary-btn"
        onClick={onClick}
        disabled={disabled}
        aria-label={label}
      >
        {label}
      </button>
    </div>
  );
}
