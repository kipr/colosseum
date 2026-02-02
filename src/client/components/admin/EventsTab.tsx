import React from 'react';

export default function EventsTab() {
  return (
    <div className="tab-content">
      <div className="tab-header">
        <h3>Manage Events</h3>
        <button className="btn-primary" onClick={() => alert('Would create new event')}>
          Create New Event
        </button>
      </div>
      
      <div className="card">
        <p>Event management features will go here.</p>
        <div style={{ marginTop: '1rem' }}>
          <button 
            className="btn-secondary"
            onClick={() => alert('Would open Events management')}
          >
            Manage Current Event
          </button>
        </div>
      </div>
    </div>
  );
}
