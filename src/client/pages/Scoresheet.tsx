import { useLoaderData } from 'react-router-dom';
import Navbar from '../components/Navbar';
import ScoresheetForm from '../components/ScoresheetForm';
import type { JudgeScoresheetTemplate } from '../loaders/scoresheetLoader';
import './Scoresheet.css';

export default function Scoresheet() {
  const template = useLoaderData() as JudgeScoresheetTemplate;

  return (
    <div className="app">
      <Navbar />
      <main className="scoresheet-page">
        <ScoresheetForm key={`scoresheet-${template.id}`} template={template} />
      </main>
    </div>
  );
}
