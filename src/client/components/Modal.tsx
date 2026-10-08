import { useId, useLayoutEffect, useRef } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import './Modal.css';

export interface ModalProps {
  children: ReactNode;
  className?: string;
  style?: CSSProperties;
  /** Disable all dismissal controls while the feature is busy. */
  closeDisabled?: boolean;
  /** Defaults to the first heading in the dialog. */
  ariaLabel?: string;
  onClose: () => void;
}

export default function Modal({
  children,
  className = '',
  style,
  closeDisabled = false,
  ariaLabel,
  onClose,
}: ModalProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const backdropPointerDown = useRef(false);
  const headingId = useId();
  const triggerRef = useRef(
    typeof document === 'undefined' ? null : document.activeElement,
  );

  useLayoutEffect(() => {
    const dialog = dialogRef.current!;
    dialog.showModal();
    // React autofocus runs before a closed native dialog can receive focus.
    // Focus the first visible form field once the dialog is open.
    const initialFocus = Array.from(
      dialog.querySelectorAll<HTMLElement>(
        'input:not([type="hidden"]):not(:disabled), textarea:not(:disabled), select:not(:disabled)',
      ),
    ).find((field) => field.getClientRects().length > 0);
    initialFocus?.focus();
    return () => {
      dialog.close();
      if (triggerRef.current instanceof HTMLElement) triggerRef.current.focus();
    };
  }, []);

  useLayoutEffect(() => {
    const dialog = dialogRef.current!;
    const heading = dialog.querySelector('h1, h2, h3, h4, h5, h6');
    if (!ariaLabel && heading) {
      if (!heading.id) heading.id = headingId;
      dialog.setAttribute('aria-labelledby', heading.id);
      dialog.removeAttribute('aria-label');
    } else {
      dialog.removeAttribute('aria-labelledby');
      dialog.setAttribute('aria-label', ariaLabel || 'Dialog');
    }
  }, [ariaLabel, children, headingId]);

  return (
    <dialog
      ref={dialogRef}
      className="modal"
      aria-modal="true"
      onCancel={(event) => {
        event.preventDefault();
        if (!closeDisabled) onClose();
      }}
      onPointerDown={(event) => {
        backdropPointerDown.current =
          event.button === 0 && event.target === event.currentTarget;
      }}
      onPointerCancel={() => {
        backdropPointerDown.current = false;
      }}
      onClick={(event) => {
        const startedOnBackdrop = backdropPointerDown.current;
        backdropPointerDown.current = false;
        if (
          startedOnBackdrop &&
          event.target === event.currentTarget &&
          !closeDisabled
        ) {
          onClose();
        }
      }}
    >
      <div className={`modal-content ${className}`.trim()} style={style}>
        <button
          type="button"
          className="close"
          aria-label="Dismiss dialog"
          disabled={closeDisabled}
          onClick={onClose}
        >
          &times;
        </button>
        {children}
      </div>
    </dialog>
  );
}
