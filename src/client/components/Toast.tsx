import {
  useState,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
} from 'react';
import { createPortal } from 'react-dom';
import { useModalLayer } from './modalLayer';
import './Toast.css';

export interface ToastMessage {
  id: string;
  type: 'success' | 'error' | 'warning' | 'info';
  message: string;
  duration?: number;
}

interface ToastProps {
  toasts: ToastMessage[];
  onDismiss: (id: string) => void;
}

function Toast({ toasts, onDismiss }: ToastProps) {
  const dialog = useModalLayer();
  const [container] = useState(() => {
    if (typeof document === 'undefined') return null;
    const element = document.createElement('div');
    element.className = 'toast-container';
    return element;
  });

  useLayoutEffect(() => {
    if (!container) return;
    // A modal makes outside content inert, regardless of its z-index.
    // Move one stable portal host so toast timers survive layer changes.
    (dialog ?? document.body).appendChild(container);
    return () => container.remove();
  }, [container, dialog]);

  if (!container) return null;
  return createPortal(
    toasts.map((toast) => (
      <ToastItem key={toast.id} toast={toast} onDismiss={onDismiss} />
    )),
    container,
  );
}

function ToastItem({
  toast,
  onDismiss,
}: {
  toast: ToastMessage;
  onDismiss: (id: string) => void;
}) {
  const [paused, setPaused] = useState(false);

  // Hover or focus holds the toast; resuming restarts the full duration.
  useEffect(() => {
    if (paused) return;
    const duration = toast.duration || 4000;
    const timer = setTimeout(() => {
      onDismiss(toast.id);
    }, duration);
    return () => clearTimeout(timer);
  }, [toast.id, toast.duration, onDismiss, paused]);

  const getIcon = () => {
    switch (toast.type) {
      case 'success':
        return '✓';
      case 'error':
        return '✕';
      case 'warning':
        return '⚠';
      case 'info':
        return 'ℹ';
    }
  };

  return (
    <div
      className={`toast toast-${toast.type}`}
      role={
        toast.type === 'error' || toast.type === 'warning' ? 'alert' : 'status'
      }
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onFocus={() => setPaused(true)}
      onBlur={() => setPaused(false)}
    >
      <span className="toast-icon">{getIcon()}</span>
      <span className="toast-message">{toast.message}</span>
      <button
        type="button"
        className="toast-close"
        aria-label="Dismiss notification"
        onClick={() => onDismiss(toast.id)}
      >
        ×
      </button>
    </div>
  );
}

// Hook for using toasts
export function useToast() {
  const [toasts, setToasts] = useState<ToastMessage[]>([]);

  const showToast = useCallback(
    (type: ToastMessage['type'], message: string, duration?: number) => {
      const id = `toast-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
      setToasts((prev) => {
        // Repeating a visible message restarts it instead of stacking a copy.
        const index = prev.findIndex(
          (t) => t.type === type && t.message === message,
        );
        if (index === -1) return [...prev, { id, type, message, duration }];
        const next = [...prev];
        next[index] = { id, type, message, duration };
        return next;
      });
    },
    [],
  );

  const dismissToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const success = useCallback(
    (message: string, duration?: number) =>
      showToast('success', message, duration),
    [showToast],
  );
  const error = useCallback(
    (message: string, duration?: number) =>
      showToast('error', message, duration || 6000),
    [showToast],
  );
  const warning = useCallback(
    (message: string, duration?: number) =>
      showToast('warning', message, duration),
    [showToast],
  );
  const info = useCallback(
    (message: string, duration?: number) =>
      showToast('info', message, duration),
    [showToast],
  );

  // Stable across renders, unlike the hook result, which carries the container.
  const notifier = useMemo(
    () => ({ success, error, warning, info }),
    [success, error, warning, info],
  );

  const ToastContainer = <Toast toasts={toasts} onDismiss={dismissToast} />;

  return { ...notifier, notifier, ToastContainer };
}

// Modals receive their tab's notifier so toasts outlive the modal.
export type ToastNotifier = ReturnType<typeof useToast>['notifier'];

export default Toast;
