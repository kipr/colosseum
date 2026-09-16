import { Link } from 'react-router-dom';
import Navbar from '../components/Navbar';
import './Home.css';

export default function Home() {
  return (
    <div className="app">
      <Navbar />
      <main className="container">
        <div className="hero">
          <h2>Welcome to Colosseum</h2>
          <p>A powerful tournament scoring and management platform</p>
        </div>

        <div className="role-selection">
          <Link to="/judge" className="role-card role-card-clickable">
            <div className="role-icon">
              <img src="/images/botguy-red-trans-small.png" alt="Judge Icon" />
            </div>
            <h3>Judge</h3>
            <p>
              Access scoresheets to evaluate and score participants in
              competitions or events.
            </p>
            <ul className="role-features">
              <li>✓ Fill out digital scoresheets</li>
              <li>✓ Submit scores to the tournament database</li>
              <li>✓ Multiple scoresheet templates</li>
              <li>✓ Real-time scoring</li>
            </ul>
          </Link>

          <Link to="/admin/events" className="role-card role-card-clickable">
            <div className="role-icon">
              <img src="/images/KIPR-Logo-bk-tiny.jpg" alt="Admin Icon" />
            </div>
            <h3>Administrator</h3>
            <p>
              Manage events, create score sheet templates, and configure
              tournaments.
            </p>
            <ul className="role-features">
              <li>✓ Create and manage events</li>
              <li>✓ Create custom score sheets</li>
              <li>✓ Review and accept submissions</li>
              <li>✓ Run brackets and seeding</li>
            </ul>
          </Link>

          <Link to="/spectator" className="role-card role-card-clickable">
            <div className="role-icon role-icon-text">
              <span>📊</span>
            </div>
            <h3>Spectator</h3>
            <p>
              Follow along with live seeding scores, rankings, and bracket
              results for active events.
            </p>
            <ul className="role-features">
              <li>✓ View seeding scores and rankings</li>
              <li>✓ Follow bracket progress</li>
              <li>✓ No login required</li>
              <li>✓ Real-time updates</li>
            </ul>
          </Link>
        </div>
      </main>
    </div>
  );
}
