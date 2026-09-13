import { useNavigate } from 'react-router-dom';
import Navbar from '../components/Navbar';
import ScoresheetForm from '../components/ScoresheetForm';
import { readStoredJudgeScoresheet } from '../utils/judgeSession';
import './Scoresheet.css';

export default function Scoresheet() {
  const navigate = useNavigate();
  const stored = readStoredJudgeScoresheet();

  if (!stored) {
    return (
      <div className="app">
        <Navbar />
        <main className="container">
          <p style={{ color: 'var(--danger-color)' }}>
            Failed to load scoresheet. Please try again.
          </p>
          <div style={{ display: 'flex', gap: '0.5rem', marginTop: '1rem' }}>
            <button
              className="btn btn-secondary"
              onClick={() => navigate('/judge')}
            >
              Back to Templates
            </button>
          </div>
        </main>
      </div>
    );
  }

  return (
    <div className="app">
      <Navbar />
      <main className="scoresheet-page">
        <ScoresheetForm
          template={stored.template}
          sessionGeneration={stored.generation}
        />
      </main>
    </div>
  );
}
