// Judge template selection page
let selectedTemplateId = null;
let selectedTemplateName = null;

// Load templates on page load
document.addEventListener('DOMContentLoaded', () => {
    loadTemplates();
    
    // Handle Enter key in access code input
    document.getElementById('accessCodeInput').addEventListener('keypress', (e) => {
        if (e.key === 'Enter') {
            verifyAccessCode();
        }
    });
    
    // Close modal when clicking outside
    window.addEventListener('click', (e) => {
        if (e.target.classList.contains('modal')) {
            e.target.classList.remove('show');
        }
    });
});

async function loadTemplates() {
    try {
        const response = await fetch('/scoresheet/templates');
        
        if (!response.ok) throw new Error('Failed to load templates');
        
        const templates = await response.json();
        displayTemplates(templates);
    } catch (error) {
        console.error('Error loading templates:', error);
        document.getElementById('templateList').innerHTML = '<p style="color: var(--danger-color);">Failed to load templates. Please refresh the page.</p>';
    }
}

function displayTemplates(templates) {
    const templateList = document.getElementById('templateList');
    
    if (templates.length === 0) {
        templateList.innerHTML = '<p>No templates available. An administrator needs to create templates first.</p>';
        return;
    }
    
    templateList.innerHTML = templates.map(template => `
        <div class="template-card" onclick="selectTemplate(${template.id}, '${template.name.replace(/'/g, "\\'")}')">
            <h3>${template.name}</h3>
            <p>${template.description || 'No description'}</p>
            <small>Created: ${new Date(template.created_at).toLocaleDateString()}</small>
        </div>
    `).join('');
}

function selectTemplate(templateId, templateName) {
    selectedTemplateId = templateId;
    selectedTemplateName = templateName;
    document.getElementById('accessCodeTemplateName').textContent = `Template: ${templateName}`;
    document.getElementById('accessCodeInput').value = '';
    document.getElementById('accessCodeError').style.display = 'none';
    document.getElementById('accessCodeModal').classList.add('show');
}

function closeAccessCodeModal() {
    document.getElementById('accessCodeModal').classList.remove('show');
    selectedTemplateId = null;
    selectedTemplateName = null;
}

async function verifyAccessCode() {
    const accessCode = document.getElementById('accessCodeInput').value.trim();
    const errorDiv = document.getElementById('accessCodeError');
    
    if (!accessCode) {
        errorDiv.textContent = 'Please enter an access code';
        errorDiv.style.display = 'block';
        return;
    }
    
    try {
        const response = await fetch(`/scoresheet/templates/${selectedTemplateId}/verify`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ accessCode })
        });
        
        if (!response.ok) {
            if (response.status === 403) {
                errorDiv.textContent = 'Invalid access code';
            } else {
                errorDiv.textContent = 'Failed to verify access code';
            }
            errorDiv.style.display = 'block';
            return;
        }
        
        const template = await response.json();
        
        // Store template data in sessionStorage and navigate
        sessionStorage.setItem('currentTemplate', JSON.stringify(template));
        
        // Create URL-friendly template name
        const urlName = selectedTemplateName.toLowerCase()
            .replace(/[^a-z0-9]+/g, '-')
            .replace(/(^-|-$)/g, '');
        
        // Navigate to scoresheet page
        window.location.href = `/scoresheet.html?template=${selectedTemplateId}&name=${encodeURIComponent(urlName)}`;
        
    } catch (error) {
        console.error('Error verifying access code:', error);
        errorDiv.textContent = 'Failed to verify access code';
        errorDiv.style.display = 'block';
    }
}

