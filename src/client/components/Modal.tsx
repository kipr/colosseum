import type { ReactNode } from 'react';
import './Modal.css';

export interface ModalProps {
  /**
   * Called when the backdrop or the × control is clicked. Callers that must
   * block dismissal (e.g. while saving) put that guard here.
   */
  onClose: () => void;
  /** Max width of the content box; numbers are pixels. Defaults to the stylesheet's 800px. */
  size?: number | string;
  /** Extra classes for the content box, alongside `modal-content`. */
  className?: string;
  children: ReactNode;
}

export default function Modal({
  onClose,
  size,
  className,
  children,
}: ModalProps) {
  return (
    <div className="modal show" onClick={() => onClose()}>
      <div
        className={className ? `modal-content ${className}` : 'modal-content'}
        style={size === undefined ? undefined : { maxWidth: size }}
        onClick={(e) => e.stopPropagation()}
      >
        <span className="close" onClick={() => onClose()} aria-label="Close">
          &times;
        </span>
        {children}
      </div>
    </div>
  );
}
