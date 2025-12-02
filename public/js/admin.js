// Admin panel logic
let currentUser = null;

// Check authentication
async function checkAuth() {
    try {
        const response = await fetch('/auth/user', {
            credentials: 'include'
        });
        
        if (response.ok) {
            currentUser = await response.json();
            document.getElementById('userInfo').textContent = currentUser.name;
            loadAdminData();
        } else {
            window.location.href = '/';
        }
    } catch (error) {
        console.error('Auth check failed:', error);
        window.location.href = '/';
    }
}

async function loadAdminData() {
    await loadLinkedSpreadsheets();
    await loadTemplates();
    await loadScoreHistory();
}

// Spreadsheet Management
async function loadLinkedSpreadsheets() {
    try {
        const response = await fetch('/admin/spreadsheets', {
            credentials: 'include'
        });
        
        if (!response.ok) throw new Error('Failed to load spreadsheets');
        
        const spreadsheets = await response.json();
        displayLinkedSpreadsheets(spreadsheets);
    } catch (error) {
        console.error('Error loading spreadsheets:', error);
    }
}

function displayLinkedSpreadsheets(spreadsheets) {
    const container = document.getElementById('linkedSpreadsheets');
    
    if (spreadsheets.length === 0) {
        container.innerHTML = '<p>No spreadsheets linked yet.</p>';
        return;
    }
    
    container.innerHTML = `
        <table>
            <thead>
                <tr>
                    <th>Name</th>
                    <th>Sheet</th>
                    <th>Status</th>
                    <th>Actions</th>
                </tr>
            </thead>
            <tbody>
                ${spreadsheets.map(sheet => `
                    <tr>
                        <td>${sheet.spreadsheet_name}</td>
                        <td>${sheet.sheet_name}</td>
                        <td>${sheet.is_active ? '<span class="text-success">Active</span>' : 'Inactive'}</td>
                        <td>
                            ${!sheet.is_active ? `<button class="btn btn-primary" onclick="activateSpreadsheet(${sheet.id})">Activate</button>` : ''}
                            <button class="btn btn-danger" onclick="deleteSpreadsheet(${sheet.id})">Delete</button>
                        </td>
                    </tr>
                `).join('')}
            </tbody>
        </table>
    `;
}

let currentDrive = null;

async function browseSpreadsheets() {
    try {
        // First, show available drives/locations
        const response = await fetch('/admin/drive/locations', {
            credentials: 'include'
        });
        
        if (!response.ok) throw new Error('Failed to browse drives');
        
        const locations = await response.json();
        displayDriveLocations(locations);
    } catch (error) {
        console.error('Error browsing drives:', error);
        alert('Failed to load drives from Google Drive');
    }
}

function displayDriveLocations(locations) {
    const container = document.getElementById('spreadsheetList');
    
    container.innerHTML = `
        <h4>Select a Location</h4>
        <div class="card" style="padding: 0;">
            ${locations.map(location => `
                <div class="drive-location-item" onclick="selectDrive('${location.id}', '${location.type}', '${location.name.replace(/'/g, "\\'")}')">
                    <span style="font-size: 1.1rem;">${location.name}</span>
                    <span style="color: var(--secondary-color);">→</span>
                </div>
            `).join('')}
        </div>
        <style>
            .drive-location-item {
                padding: 1rem 1.5rem;
                border-bottom: 1px solid var(--border-color);
                cursor: pointer;
                display: flex;
                justify-content: space-between;
                align-items: center;
                transition: background-color 0.2s;
            }
            .drive-location-item:hover {
                background-color: var(--bg-color);
            }
            .drive-location-item:last-child {
                border-bottom: none;
            }
        </style>
    `;
}

async function selectDrive(driveId, driveType, driveName) {
    currentDrive = { id: driveId, type: driveType, name: driveName };
    
    try {
        const url = `/admin/drive/spreadsheets?driveId=${encodeURIComponent(driveId)}&driveType=${encodeURIComponent(driveType)}`;
        const response = await fetch(url, {
            credentials: 'include'
        });
        
        if (!response.ok) throw new Error('Failed to list spreadsheets');
        
        const spreadsheets = await response.json();
        displaySpreadsheetList(spreadsheets, driveName);
    } catch (error) {
        console.error('Error listing spreadsheets:', error);
        alert('Failed to load spreadsheets from this location');
    }
}

function displaySpreadsheetList(spreadsheets, locationName) {
    const container = document.getElementById('spreadsheetList');
    
    if (spreadsheets.length === 0) {
        container.innerHTML = `
            <button class="btn btn-secondary" onclick="browseSpreadsheets()" style="margin-bottom: 1rem;">
                ← Back to Locations
            </button>
            <p>No spreadsheets found in ${locationName}.</p>
        `;
        return;
    }
    
    container.innerHTML = `
        <button class="btn btn-secondary" onclick="browseSpreadsheets()" style="margin-bottom: 1rem;">
            ← Back to Locations
        </button>
        <h4>Spreadsheets in ${locationName}</h4>
        <table>
            <thead>
                <tr>
                    <th>Name</th>
                    <th>Modified</th>
                    <th>Action</th>
                </tr>
            </thead>
            <tbody>
                ${spreadsheets.map(sheet => `
                    <tr>
                        <td>${sheet.name}</td>
                        <td>${new Date(sheet.modifiedTime).toLocaleString()}</td>
                        <td><button class="btn btn-primary" onclick="linkSpreadsheet('${sheet.id}', '${sheet.name.replace(/'/g, "\\'")}')">Link</button></td>
                    </tr>
                `).join('')}
            </tbody>
        </table>
    `;
}

let selectedSpreadsheetForLink = null;

async function linkSpreadsheet(spreadsheetId, name) {
    selectedSpreadsheetForLink = { id: spreadsheetId, name: name };
    
    // Show modal
    const modal = document.getElementById('sheetSelectionModal');
    modal.classList.add('show');
    
    // Update spreadsheet name in modal
    document.getElementById('selectedSpreadsheetName').textContent = `Spreadsheet: ${name}`;
    
    // Fetch available sheets
    try {
        const response = await fetch(`/admin/spreadsheets/${spreadsheetId}/sheets`, {
            credentials: 'include'
        });
        
        if (!response.ok) throw new Error('Failed to fetch sheets');
        
        const sheets = await response.json();
        const select = document.getElementById('sheetNameSelect');
        
        if (sheets.length === 0) {
            select.innerHTML = '<option value="">No sheets found</option>';
            return;
        }
        
        // Populate dropdown with sheets
        select.innerHTML = sheets
            .sort((a, b) => a.index - b.index)
            .map(sheet => `<option value="${sheet.title}">${sheet.title}</option>`)
            .join('');
            
    } catch (error) {
        console.error('Error fetching sheets:', error);
        const select = document.getElementById('sheetNameSelect');
        select.innerHTML = '<option value="">Error loading sheets</option>';
        alert('Failed to load sheets from spreadsheet');
    }
}

function closeSheetModal() {
    document.getElementById('sheetSelectionModal').classList.remove('show');
    selectedSpreadsheetForLink = null;
}

async function confirmSheetSelection() {
    if (!selectedSpreadsheetForLink) return;
    
    const sheetName = document.getElementById('sheetNameSelect').value;
    if (!sheetName) {
        alert('Please select a sheet');
        return;
    }
    
    try {
        const response = await fetch('/admin/spreadsheets/link', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify({ 
                spreadsheetId: selectedSpreadsheetForLink.id, 
                sheetName 
            })
        });
        
        if (!response.ok) throw new Error('Failed to link spreadsheet');
        
        // Close modal
        closeSheetModal();
        
        // Show success message (non-intrusive)
        showSuccessMessage('Spreadsheet linked successfully!');
        
        // Refresh list
        await loadLinkedSpreadsheets();
        document.getElementById('spreadsheetList').innerHTML = '';
    } catch (error) {
        console.error('Error linking spreadsheet:', error);
        alert('Failed to link spreadsheet');
    }
}

function showSuccessMessage(message) {
    // Create a temporary success message overlay
    const messageDiv = document.createElement('div');
    messageDiv.textContent = message;
    messageDiv.style.cssText = `
        position: fixed;
        top: 20px;
        right: 20px;
        background-color: var(--success-color);
        color: white;
        padding: 1rem 1.5rem;
        border-radius: 0.5rem;
        box-shadow: var(--shadow-lg);
        z-index: 2000;
        animation: slideIn 0.3s ease-out;
    `;
    
    document.body.appendChild(messageDiv);
    
    // Remove after 3 seconds
    setTimeout(() => {
        messageDiv.style.animation = 'slideOut 0.3s ease-out';
        setTimeout(() => messageDiv.remove(), 300);
    }, 3000);
}

async function activateSpreadsheet(id) {
    try {
        const response = await fetch(`/admin/spreadsheets/${id}/activate`, {
            method: 'PUT',
            credentials: 'include'
        });
        
        if (!response.ok) throw new Error('Failed to activate spreadsheet');
        
        await loadLinkedSpreadsheets();
    } catch (error) {
        console.error('Error activating spreadsheet:', error);
        alert('Failed to activate spreadsheet');
    }
}

async function deleteSpreadsheet(id) {
    if (!confirm('Are you sure you want to delete this spreadsheet configuration?')) return;
    
    try {
        const response = await fetch(`/admin/spreadsheets/${id}`, {
            method: 'DELETE',
            credentials: 'include'
        });
        
        if (!response.ok) throw new Error('Failed to delete spreadsheet');
        
        await loadLinkedSpreadsheets();
    } catch (error) {
        console.error('Error deleting spreadsheet:', error);
        alert('Failed to delete spreadsheet');
    }
}

// Template Management
async function loadTemplates() {
    try {
        const response = await fetch('/scoresheet/templates/admin', {
            credentials: 'include'
        });
        
        if (!response.ok) throw new Error('Failed to load templates');
        
        const templates = await response.json();
        displayTemplates(templates);
    } catch (error) {
        console.error('Error loading templates:', error);
    }
}

function displayTemplates(templates) {
    const container = document.getElementById('templatesList');
    
    if (templates.length === 0) {
        container.innerHTML = '<p>No templates created yet.</p>';
        return;
    }
    
    container.innerHTML = `
        <table>
            <thead>
                <tr>
                    <th>Name</th>
                    <th>Description</th>
                    <th>Access Code</th>
                    <th>Created</th>
                    <th>Actions</th>
                </tr>
            </thead>
            <tbody>
                ${templates.map(template => `
                    <tr>
                        <td>${template.name}</td>
                        <td>${template.description || '<em style="color: var(--secondary-color);">No description</em>'}</td>
                        <td><code style="background: var(--bg-color); padding: 0.25rem 0.5rem; border-radius: 0.25rem;">${template.access_code || 'N/A'}</code></td>
                        <td>${new Date(template.created_at).toLocaleDateString()}</td>
                        <td>
                            <button class="btn btn-primary" onclick="previewTemplate(${template.id})">Preview</button>
                            <button class="btn btn-secondary" onclick="editTemplate(${template.id})">Edit</button>
                        </td>
                    </tr>
                `).join('')}
            </tbody>
        </table>
    `;
}

let currentEditingTemplateId = null;

async function showTemplateEditor(templateId = null) {
    currentEditingTemplateId = templateId;
    const modal = document.getElementById('templateEditorModal');
    modal.classList.add('show');
    
    if (templateId) {
        // Load existing template
        try {
            const response = await fetch(`/scoresheet/templates/${templateId}`, {
                credentials: 'include'
            });
            const template = await response.json();
            
            document.getElementById('templateName').value = template.name;
            document.getElementById('templateDescription').value = template.description || '';
            document.getElementById('templateAccessCode').value = template.access_code || '';
            document.getElementById('templateSchema').value = JSON.stringify(template.schema, null, 2);
        } catch (error) {
            console.error('Error loading template:', error);
        }
    } else {
        // New template with example schema
        document.getElementById('templateName').value = '';
        document.getElementById('templateDescription').value = '';
        document.getElementById('templateAccessCode').value = '';
        document.getElementById('templateSchema').value = JSON.stringify({
            fields: [
                {
                    id: "example_field",
                    label: "Example Field",
                    type: "text",
                    required: true,
                    placeholder: "Enter value"
                }
            ]
        }, null, 2);
    }
}

function editTemplate(templateId) {
    showTemplateEditor(templateId);
}

async function saveTemplate(e) {
    e.preventDefault();
    
    const name = document.getElementById('templateName').value;
    const description = document.getElementById('templateDescription').value;
    const accessCode = document.getElementById('templateAccessCode').value;
    const schemaText = document.getElementById('templateSchema').value;
    
    if (!accessCode.trim()) {
        alert('Access code is required');
        return;
    }
    
    try {
        const schema = JSON.parse(schemaText);
        
        const method = currentEditingTemplateId ? 'PUT' : 'POST';
        const url = currentEditingTemplateId 
            ? `/scoresheet/templates/${currentEditingTemplateId}`
            : '/scoresheet/templates';
        
        const response = await fetch(url, {
            method,
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify({ name, description, accessCode, schema })
        });
        
        if (!response.ok) throw new Error('Failed to save template');
        
        showSuccessMessage(currentEditingTemplateId ? 'Template updated successfully!' : 'Template created successfully!');
        document.getElementById('templateEditorModal').classList.remove('show');
        currentEditingTemplateId = null;
        await loadTemplates();
    } catch (error) {
        console.error('Error saving template:', error);
        if (error instanceof SyntaxError) {
            alert('Invalid JSON schema. Please check your syntax.');
        } else {
            alert('Failed to save template. Please try again.');
        }
    }
}

// Score History
async function loadScoreHistory() {
    try {
        const response = await fetch('/api/scores/history', {
            credentials: 'include'
        });
        
        if (!response.ok) throw new Error('Failed to load score history');
        
        const scores = await response.json();
        displayScoreHistory(scores);
    } catch (error) {
        console.error('Error loading score history:', error);
    }
}

function displayScoreHistory(scores) {
    const container = document.getElementById('scoreHistory');
    
    if (scores.length === 0) {
        container.innerHTML = '<p>No scores submitted yet.</p>';
        return;
    }
    
    container.innerHTML = `
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
                ${scores.map(score => `
                    <tr>
                        <td>${score.template_name}</td>
                        <td>${score.participant_name || '-'}</td>
                        <td>${score.match_id || '-'}</td>
                        <td>${new Date(score.created_at).toLocaleString()}</td>
                        <td>${score.submitted_to_sheet ? '<span class="text-success">Synced</span>' : '<span class="text-danger">Local only</span>'}</td>
                    </tr>
                `).join('')}
            </tbody>
        </table>
    `;
}

// Event Listeners
document.addEventListener('DOMContentLoaded', () => {
    checkAuth();
    
    // Tab navigation
    document.querySelectorAll('.sidebar-item').forEach(item => {
        item.addEventListener('click', function() {
            const tab = this.dataset.tab;
            
            // Update sidebar
            document.querySelectorAll('.sidebar-item').forEach(i => i.classList.remove('active'));
            this.classList.add('active');
            
            // Update content
            document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
            document.getElementById(`${tab}Tab`).classList.add('active');
        });
    });
    
    // Logout
    document.getElementById('logoutBtn').addEventListener('click', () => {
        window.location.href = '/auth/logout';
    });
    
    // Browse spreadsheets
    document.getElementById('browseSpreadsheets').addEventListener('click', browseSpreadsheets);
    
    // Create template
    document.getElementById('createTemplateBtn').addEventListener('click', () => showTemplateEditor());
    
    // Close template modal
    // (handled by onclick in HTML now)
    
    // Save template
    document.getElementById('templateForm').addEventListener('submit', saveTemplate);
    
    // Close modals when clicking outside
    window.addEventListener('click', (e) => {
        if (e.target.classList.contains('modal')) {
            e.target.classList.remove('show');
        }
    });
});

function closeTemplateModal() {
    document.getElementById('templateEditorModal').classList.remove('show');
}

// Template Preview
async function previewTemplate(templateId) {
    try {
        const response = await fetch(`/scoresheet/templates/${templateId}`, {
            credentials: 'include'
        });
        
        if (!response.ok) throw new Error('Failed to load template');
        
        const template = await response.json();
        
        // Show modal
        const modal = document.getElementById('templatePreviewModal');
        modal.classList.add('show');
        
        // Render preview
        renderTemplatePreview(template);
    } catch (error) {
        console.error('Error loading template preview:', error);
        alert('Failed to load template preview');
    }
}

function closePreviewModal() {
    document.getElementById('templatePreviewModal').classList.remove('show');
}

function renderTemplatePreview(template) {
    const container = document.getElementById('previewContainer');
    const schema = template.schema;
    
    let html = '<div class="scoresheet-form" style="background: white;">';
    
    // Add title if present
    if (schema.title) {
        html += `<div class="scoresheet-title">${schema.title}</div>`;
    }
    
    // Header fields (team name, team number, round)
    html += '<div class="scoresheet-header-fields">';
    schema.fields.filter(f => !f.column).forEach(field => {
        if (field.type !== 'section_header' && field.type !== 'group_header') {
            html += renderPreviewField(field);
        }
    });
    html += '</div>';
    
    // Check if two-column layout
    if (schema.layout === 'two-column') {
        html += '<div class="scoresheet-columns">';
        html += '<div class="scoresheet-column">';
        
        // Render left column
        schema.fields.filter(f => f.column === 'left').forEach(field => {
            html += renderPreviewField(field);
        });
        
        html += '</div><div class="scoresheet-column">';
        
        // Render right column
        schema.fields.filter(f => f.column === 'right').forEach(field => {
            html += renderPreviewField(field);
        });
        
        html += '</div></div>';
    } else {
        // Single column layout
        schema.fields.forEach(field => {
            if (!field.column) {
                html += renderPreviewField(field);
            }
        });
    }
    
    html += '</div>';
    
    container.innerHTML = html;
}

function renderPreviewField(field) {
    if (field.type === 'section_header') {
        return `<div class="section-header">${field.label}</div>`;
    }
    
    if (field.type === 'group_header') {
        return `<div class="group-header">${field.label}</div>`;
    }
    
    let html = `<div class="score-field">`;
    html += `<label class="score-label">${field.label}${field.suffix ? ` <span class="multiplier">${field.suffix}</span>` : ''}</label>`;
    
    switch (field.type) {
        case 'text':
            html += `<input type="text" class="score-input" placeholder="${field.placeholder || ''}" disabled>`;
            break;
        case 'number':
            html += `<input type="number" class="score-input" value="0" disabled>`;
            break;
        case 'dropdown':
            html += `<select class="score-input" disabled><option>Select...</option></select>`;
            break;
        case 'buttons':
            html += '<div class="score-button-group">';
            field.options.forEach(option => {
                html += `<button type="button" class="score-option-button" disabled>${option.label}</button>`;
            });
            html += '</div>';
            break;
        case 'checkbox':
            html += `<input type="checkbox" disabled>`;
            break;
        default:
            html += `<input type="text" class="score-input" disabled>`;
    }
    
    html += '</div>';
    return html;
}

