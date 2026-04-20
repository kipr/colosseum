import { useState } from 'react';
import { Modal, ModalActions } from '../../Modal';

interface PopulateFromSeedingModalProps {
  open: boolean;
  onClose: () => void;
  onSubmit: () => Promise<void>;
}

export function PopulateFromSeedingModal({
  open,
  onClose,
  onSubmit,
}: PopulateFromSeedingModalProps) {
  const [populating, setPopulating] = useState(false);

  const handleClick = async () => {
    setPopulating(true);
    try {
      await onSubmit();
    } finally {
      setPopulating(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Populate Queue from Seeding"
      maxWidth={500}
    >
      <p style={{ color: 'var(--secondary-color)', marginBottom: '1.5rem' }}>
        This will completely clear the existing queue and replace it with all
        unplayed seeding rounds (team + round combinations that don&apos;t have
        a score yet).
      </p>

      <ModalActions>
        <button
          type="button"
          className="btn btn-secondary"
          onClick={onClose}
          disabled={populating}
        >
          Cancel
        </button>
        <button
          type="button"
          className="btn btn-danger"
          onClick={handleClick}
          disabled={populating}
        >
          {populating ? 'Populating...' : 'Populate Queue'}
        </button>
      </ModalActions>
    </Modal>
  );
}
