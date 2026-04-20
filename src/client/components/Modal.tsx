import React from 'react';
import './Modal.css';

export interface ModalProps {
  open: boolean;
  onClose: () => void;
  title?: React.ReactNode;
  /** Override the default `max-width` of the inner content panel. */
  maxWidth?: number | string;
  /** Optional explicit width for the inner content panel. */
  width?: number | string;
  /** Extra className applied to the inner content panel. */
  contentClassName?: string;
  children?: React.ReactNode;
}

/**
 * Shared modal scaffold. Replaces the hand-rolled
 *   <div className="modal show" onClick={close}>
 *     <div className="modal-content" onClick={stop}>
 *       <span className="close" onClick={close}>×</span>
 *       ...
 *
 * pattern used across nearly every admin tab. DOM output (classes, structure)
 * matches the previous inline form exactly so existing CSS selectors keep
 * working.
 */
export function Modal({
  open,
  onClose,
  title,
  maxWidth,
  width,
  contentClassName,
  children,
}: ModalProps): React.ReactElement | null {
  if (!open) return null;

  const style: React.CSSProperties = {};
  if (maxWidth !== undefined) {
    style.maxWidth = typeof maxWidth === 'number' ? `${maxWidth}px` : maxWidth;
  }
  if (width !== undefined) {
    style.width = typeof width === 'number' ? `${width}px` : width;
  }

  const contentClass = ['modal-content', contentClassName ?? '']
    .filter(Boolean)
    .join(' ');

  return (
    <div className="modal show" onClick={onClose}>
      <div
        className={contentClass}
        style={Object.keys(style).length > 0 ? style : undefined}
        onClick={(event) => event.stopPropagation()}
      >
        <span className="close" onClick={onClose}>
          &times;
        </span>
        {title !== undefined && <h3>{title}</h3>}
        {children}
      </div>
    </div>
  );
}

export interface ModalActionsProps {
  children: React.ReactNode;
  /** justify-content value for the action row; defaults to flex-end. */
  align?: 'flex-end' | 'space-between' | 'center';
  /** Top margin override; defaults to 1.5rem to match the existing inline style. */
  marginTop?: string;
}

/** Right-aligned action row used at the bottom of nearly every modal. */
export function ModalActions({
  children,
  align = 'flex-end',
  marginTop = '1.5rem',
}: ModalActionsProps): React.ReactElement {
  return (
    <div
      style={{
        display: 'flex',
        gap: '0.5rem',
        justifyContent: align,
        marginTop,
      }}
    >
      {children}
    </div>
  );
}
