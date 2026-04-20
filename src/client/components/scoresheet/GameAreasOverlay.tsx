interface GameAreasOverlayProps {
  image: string;
  onClose: () => void;
}

/** Modal-like overlay that displays a single zoomed Game Areas image. */
export function GameAreasOverlay({ image, onClose }: GameAreasOverlayProps) {
  return (
    <div
      className="game-areas-overlay"
      onClick={onClose}
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        backgroundColor: 'rgba(0, 0, 0, 0.85)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 1000,
        padding: '1rem',
        cursor: 'pointer',
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          position: 'relative',
          maxWidth: '95vw',
          maxHeight: '95vh',
        }}
      >
        <button
          onClick={onClose}
          style={{
            position: 'absolute',
            top: '-40px',
            right: '0',
            background: 'white',
            border: 'none',
            borderRadius: '50%',
            width: '36px',
            height: '36px',
            fontSize: '24px',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            boxShadow: '0 2px 8px rgba(0,0,0,0.3)',
          }}
        >
          ×
        </button>
        <img
          src={image}
          alt="Game Areas"
          style={{
            maxWidth: '100%',
            maxHeight: '90vh',
            borderRadius: '0.5rem',
            boxShadow: '0 4px 20px rgba(0,0,0,0.5)',
          }}
        />
      </div>
    </div>
  );
}
