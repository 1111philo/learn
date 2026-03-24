import { createContext, useContext, useState, useCallback, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';

const ModalContext = createContext(null);

export function ModalProvider({ children }) {
  const [modal, setModal] = useState(null); // { content: ReactNode, role, label }

  const show = useCallback((content, role = 'dialog', label = '') => {
    setModal({ content, role, label });
  }, []);

  const hide = useCallback(() => setModal(null), []);

  return (
    <ModalContext.Provider value={{ show, hide, isOpen: !!modal }}>
      {children}
      {modal && <ModalOverlay {...modal} onClose={hide} />}
    </ModalContext.Provider>
  );
}

export function useModal() {
  const ctx = useContext(ModalContext);
  if (!ctx) throw new Error('useModal must be used within ModalProvider');
  return ctx;
}

function ModalOverlay({ content, role, label, onClose }) {
  const overlayRef = useRef(null);
  const triggerRef = useRef(document.activeElement);

  // Escape to close
  useEffect(() => {
    const handler = (e) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [onClose]);

  // Focus first focusable on mount, restore on unmount
  useEffect(() => {
    const modal = overlayRef.current?.querySelector('.modal');
    const focusable = modal?.querySelector('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])');
    focusable?.focus();
    return () => triggerRef.current?.focus();
  }, []);

  // Focus trap — keep Tab/Shift+Tab inside the modal
  useEffect(() => {
    const modal = overlayRef.current?.querySelector('.modal');
    if (!modal) return;
    const handler = (e) => {
      if (e.key !== 'Tab') return;
      const focusables = modal.querySelectorAll('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])');
      if (!focusables.length) return;
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, []);

  // Click outside to close
  const handleOverlayClick = (e) => {
    if (e.target === overlayRef.current) onClose();
  };

  return createPortal(
    <div
      id="modal-overlay"
      ref={overlayRef}
      onClick={handleOverlayClick}
      style={{ position: 'fixed', inset: 0, zIndex: 200,
        background: 'rgba(255,255,255,0.55)', backdropFilter: 'blur(6px)', WebkitBackdropFilter: 'blur(6px)',
        display: 'flex', alignItems: 'center', justifyContent: 'center' }}
    >
      <div className="modal" role={role} aria-modal="true" aria-label={label || undefined}>
        {content}
      </div>
    </div>,
    document.body
  );
}
