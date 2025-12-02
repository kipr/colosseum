import React, { useEffect, useState } from 'react';

interface ScoreSubmission {
  id: number;
  template_name: string;
  participant_name: string;
  match_id: string;
  created_at: string;
  submitted_to_sheet: boolean;
}

export default function HistoryTab() {
  const [scores, setScores] = useState<ScoreSubmission[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadScoreHistory();
  }, []);

  const loadScoreHistory = async () => {
    try {
      const response = await fetch('/api/scores/history', { credentials: 'include' });
      if (!response.ok) throw new Error('Failed to load score history');
      const data = await response.json();
      setScores(data);
    } catch (error) {
      console.error('Error loading score history:', error);
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return <div><h2>Score Submission History</h2><p>Loading...</p></div>;
  }

  return (
    <div>
      <h2>Score Submission History</h2>
      {scores.length === 0 ? (
        <p>No scores submitted yet.</p>
      ) : (
        <table>
          <thead>
            <tr>
              <th>Template</th>
              <th>Participant</th>
              <th>Match ID</th>
              <th>Submitted</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {scores.map(score => (
              <tr key={score.id}>
                <td>{score.template_name}</td>
                <td>{score.participant_name || '-'}</td>
                <td>{score.match_id || '-'}</td>
                <td>{new Date(score.created_at).toLocaleString()}</td>
                <td>
                  {score.submitted_to_sheet ? (
                    <span className="text-success">Synced</span>
                  ) : (
                    <span className="text-danger">Local only</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

