import TemplatePreviewModal from './TemplatePreviewModal';

// Renamed export for ScoreSheet terminology
interface ScoreSheetPreviewModalProps {
  scoreSheetId: number;
  onClose: () => void;
}

// Wrapper component that uses the existing TemplatePreviewModal
export default function ScoreSheetPreviewModal({ scoreSheetId, onClose }: ScoreSheetPreviewModalProps) {
  return <TemplatePreviewModal templateId={scoreSheetId} onClose={onClose} />;
}

