import TemplatePreviewModal from './TemplatePreviewModal';
import type { ToastNotifier } from '../Toast';

// Renamed export for ScoreSheet terminology
interface ScoreSheetPreviewModalProps {
  scoreSheetId: number;
  onClose: () => void;
  toast: ToastNotifier;
}

// Wrapper component that uses the existing TemplatePreviewModal
export default function ScoreSheetPreviewModal({
  scoreSheetId,
  onClose,
  toast,
}: ScoreSheetPreviewModalProps) {
  return (
    <TemplatePreviewModal
      templateId={scoreSheetId}
      onClose={onClose}
      toast={toast}
    />
  );
}
