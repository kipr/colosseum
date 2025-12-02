// Scoresheet rendering and submission logic

function renderScoresheet(template) {
    const container = document.getElementById('scoresheetForm');
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
            html += renderTextField(field);
            break;
        case 'number':
            html += renderNumberField(field);
            break;
        case 'dropdown':
            html += renderDropdownField(field);
            break;
        case 'buttons':
            html += renderButtonField(field);
            break;
        case 'checkbox':
            html += renderCheckboxField(field);
            break;
        default:
            html += `<input type="text" id="field_${field.id}" class="score-input">`;
    }
    
    html += '</div>';
    return html;
}

function renderTextField(field) {
    return `<input type="text" 
                   id="field_${field.id}" 
                   class="score-input" 
                   placeholder="${field.placeholder || ''}"
                   ${field.required ? 'required' : ''}>`;
}

function renderNumberField(field) {
    return `<input type="number" 
                   id="field_${field.id}" 
                   class="score-input" 
                   min="${field.min || 0}"
                   max="${field.max || ''}"
                   step="${field.step || 1}"
                   value="0"
                   ${field.required ? 'required' : ''}>`;
}

function renderDropdownField(field) {
    let html = `<select id="field_${field.id}" class="score-input" ${field.required ? 'required' : ''}>`;
    html += '<option value="">Select an option</option>';
    
    field.options.forEach(option => {
        html += `<option value="${option.value}">${option.label}</option>`;
    });
    
    html += '</select>';
    return html;
}

function renderButtonField(field) {
    let html = '<div class="score-button-group">';
    
    field.options.forEach(option => {
        html += `<button type="button" 
                        class="score-option-button" 
                        data-field-id="${field.id}"
                        data-value="${option.value}">
                    ${option.label}
                 </button>`;
    });
    
    html += '</div>';
    return html;
}

function renderCheckboxField(field) {
    return `<label style="display: flex; align-items: center; gap: 0.5rem;">
                <input type="checkbox" 
                       id="field_${field.id}" 
                       ${field.required ? 'required' : ''}>
                <span>${field.checkboxLabel || 'Yes'}</span>
            </label>`;
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
            credentials: 'include',
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

