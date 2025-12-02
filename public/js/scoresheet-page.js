// Scoresheet page logic
let currentTemplate = null;

document.addEventListener('DOMContentLoaded', () => {
    loadScoresheet();
});

async function loadScoresheet() {
    try {
        // Get template from sessionStorage
        const templateData = sessionStorage.getItem('currentTemplate');
        
        if (!templateData) {
            // If no template in session, redirect back
            showError();
            return;
        }
        
        currentTemplate = JSON.parse(templateData);
        
        // Hide loading, show scoresheet
        document.getElementById('loadingMessage').style.display = 'none';
        document.getElementById('scoresheetContainer').style.display = 'block';
        
        // Render the scoresheet
        renderScoresheet(currentTemplate);
        
    } catch (error) {
        console.error('Error loading scoresheet:', error);
        showError();
    }
}

function showError() {
    document.getElementById('loadingMessage').style.display = 'none';
    document.getElementById('errorMessage').style.display = 'block';
}

function renderScoresheet(template) {
    const container = document.getElementById('scoresheetContainer');
    const schema = template.schema;
    
    let formHTML = '<form id="scoreForm" class="scoresheet-form">';
    
    // Add title if present
    if (schema.title) {
        formHTML += `<div class="scoresheet-title">${schema.title}</div>`;
    }
    
    // Header fields (team name, team number, round)
    formHTML += '<div class="scoresheet-header-fields">';
    schema.fields.filter(f => !f.column).forEach(field => {
        if (field.type !== 'section_header' && field.type !== 'group_header') {
            formHTML += renderField(field);
        }
    });
    formHTML += '</div>';
    
    // Check if two-column layout
    if (schema.layout === 'two-column') {
        formHTML += '<div class="scoresheet-columns">';
        formHTML += '<div class="scoresheet-column">';
        
        // Render left column
        schema.fields.filter(f => f.column === 'left').forEach(field => {
            formHTML += renderField(field);
        });
        
        formHTML += '</div><div class="scoresheet-column">';
        
        // Render right column
        schema.fields.filter(f => f.column === 'right').forEach(field => {
            formHTML += renderField(field);
        });
        
        formHTML += '</div></div>';
    } else {
        // Single column layout
        schema.fields.forEach(field => {
            if (!field.column) {
                formHTML += renderField(field);
            }
        });
    }
    
    formHTML += `
        <div class="scoresheet-footer">
            <button type="submit" class="btn btn-primary btn-large">Submit Score</button>
        </div>
    `;
    
    formHTML += '</form>';
    
    container.innerHTML = formHTML;
    
    // Add event listeners
    attachFieldListeners(schema);
    document.getElementById('scoreForm').addEventListener('submit', handleScoreSubmit);
}

function renderField(field) {
    if (field.type === 'section_header') {
        return `<div class="section-header">${field.label}</div>`;
    }
    
    if (field.type === 'group_header') {
        return `<div class="group-header">${field.label}</div>`;
    }
    
    let html = `<div class="score-field" data-field-id="${field.id}">`;
    html += `<label class="score-label">${field.label}${field.suffix ? ` <span class="multiplier">${field.suffix}</span>` : ''}</label>`;
    
    switch (field.type) {
        case 'text':
            html += `<input type="text" id="field_${field.id}" class="score-input" placeholder="${field.placeholder || ''}" ${field.required ? 'required' : ''}>`;
            break;
        case 'number':
            html += `<input type="number" id="field_${field.id}" class="score-input" min="${field.min || 0}" max="${field.max || ''}" step="${field.step || 1}" value="0" ${field.required ? 'required' : ''}>`;
            break;
        case 'dropdown':
            html += `<select id="field_${field.id}" class="score-input" ${field.required ? 'required' : ''}><option value="">Select...</option>`;
            field.options.forEach(option => {
                html += `<option value="${option.value}">${option.label}</option>`;
            });
            html += '</select>';
            break;
        case 'buttons':
            html += '<div class="score-button-group">';
            field.options.forEach(option => {
                html += `<button type="button" class="score-option-button" data-field-id="${field.id}" data-value="${option.value}">${option.label}</button>`;
            });
            html += '</div>';
            break;
        case 'checkbox':
            html += `<input type="checkbox" id="field_${field.id}" ${field.required ? 'required' : ''}>`;
            break;
        default:
            html += `<input type="text" id="field_${field.id}" class="score-input">`;
    }
    
    html += '</div>';
    return html;
}

function attachFieldListeners(schema) {
    // Handle button field selections
    document.querySelectorAll('.score-option-button').forEach(button => {
        button.addEventListener('click', function() {
            const fieldId = this.dataset.fieldId;
            
            // Deselect other buttons in the same group
            document.querySelectorAll(`.score-option-button[data-field-id="${fieldId}"]`).forEach(btn => {
                btn.classList.remove('selected');
            });
            
            // Select this button
            this.classList.add('selected');
        });
    });
}

async function handleScoreSubmit(e) {
    e.preventDefault();
    
    const schema = currentTemplate.schema;
    const scoreData = {};
    
    // Collect data from all fields (skip headers)
    schema.fields.forEach(field => {
        if (field.type === 'section_header' || field.type === 'group_header') {
            return; // Skip headers
        }
        
        let value;
        
        if (field.type === 'buttons') {
            const selectedButton = document.querySelector(`.score-option-button[data-field-id="${field.id}"].selected`);
            value = selectedButton ? selectedButton.dataset.value : null;
        } else if (field.type === 'checkbox') {
            const checkbox = document.getElementById(`field_${field.id}`);
            value = checkbox ? checkbox.checked : false;
        } else {
            const input = document.getElementById(`field_${field.id}`);
            value = input ? input.value : '';
        }
        
        scoreData[field.id] = {
            label: field.label,
            value: value,
            type: field.type
        };
    });
    
    const participantName = scoreData['team_name'] ? scoreData['team_name'].value : '';
    const matchId = scoreData['round'] ? scoreData['round'].value : '';
    
    // Submit to backend
    try {
        const response = await fetch('/api/scores/submit', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                templateId: currentTemplate.id,
                participantName,
                matchId,
                scoreData
            })
        });
        
        if (!response.ok) {
            throw new Error('Failed to submit score');
        }
        
        alert('Score submitted successfully!');
        
        // Reset form
        document.getElementById('scoreForm').reset();
        document.querySelectorAll('.score-option-button').forEach(btn => {
            btn.classList.remove('selected');
        });
        
        // Reset number inputs to 0
        document.querySelectorAll('.score-input[type="number"]').forEach(input => {
            input.value = 0;
        });
        
    } catch (error) {
        console.error('Error submitting score:', error);
        alert('Failed to submit score. Please try again.');
    }
}

