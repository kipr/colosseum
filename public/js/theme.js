// Theme management
(function() {
    // Get saved theme or default to light
    const savedTheme = localStorage.getItem('theme') || 'light';
    
    // Apply theme immediately to prevent flash
    document.documentElement.setAttribute('data-theme', savedTheme);
    
    // Update icon when DOM is ready
    document.addEventListener('DOMContentLoaded', () => {
        updateThemeIcon(savedTheme);
        
        // Add click handler to theme toggle
        const themeToggle = document.getElementById('themeToggle');
        if (themeToggle) {
            themeToggle.addEventListener('click', toggleTheme);
        }
    });
    
    function toggleTheme() {
        const currentTheme = document.documentElement.getAttribute('data-theme');
        const newTheme = currentTheme === 'dark' ? 'light' : 'dark';
        
        document.documentElement.setAttribute('data-theme', newTheme);
        localStorage.setItem('theme', newTheme);
        updateThemeIcon(newTheme);
    }
    
    function updateThemeIcon(theme) {
        const toggles = document.querySelectorAll('#themeToggle');
        toggles.forEach(toggle => {
            const icon = toggle.querySelector('.theme-icon');
            const label = toggle.querySelector('.theme-label');
            if (icon) {
                icon.textContent = theme === 'dark' ? '☀️' : '🌙';
            }
            if (label) {
                label.textContent = theme === 'dark' ? 'Light' : 'Dark';
            }
        });
    }
})();

