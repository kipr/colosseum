import type { CSSProperties, ReactNode } from 'react';
import './Modal.css';

export interface ModalProps {
  children: ReactNode;
  /** Maximum content width; omit to use the default modal sizing. */
  size?: CSSProperties['maxWidth'];
  className?: string;
  style?: CSSProperties;
  /** Feature-owned callback, including any guards against dismissal. */
  onClose: () => void;
}

export default function Modal({
  children,
  size,
  className = '',
  style,
  onClose,
}: ModalProps) {
  return (
    <div
      className="modal show"
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        className={`modal-content ${className}`.trim()}
        style={{ maxWidth: size, ...style }}
        onClick={(event) => event.stopPropagation()}
      >
        <button
          type="button"
          className="close"
          aria-label="Close"
          onClick={onClose}
        >
          &times;
        </button>
        {children}
      </div>
    </div>
  );
}
