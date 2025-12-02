// Main application logic (simplified for home page)
let currentUser = null;

// Check authentication status on page load
async function checkAuth() {
    try {
        const response = await fetch('/auth/user', {
            credentials: 'include'
        });
        
        if (response.ok) {
            currentUser = await response.json();
            updateUIForAuthenticatedUser();
        } else {
            updateUIForGuest();
        }
    } catch (error) {
        console.error('Auth check failed:', error);
        updateUIForGuest();
    }
}

function updateUIForAuthenticatedUser() {
    document.getElementById('loginBtn').style.display = 'none';
    document.getElementById('logoutBtn').style.display = 'inline-block';
    document.getElementById('adminLink').style.display = 'inline-block';
    document.getElementById('userInfo').style.display = 'inline-block';
    document.getElementById('userInfo').textContent = currentUser.name;
}

function updateUIForGuest() {
    document.getElementById('loginBtn').style.display = 'inline-block';
    document.getElementById('logoutBtn').style.display = 'none';
    document.getElementById('adminLink').style.display = 'none';
    document.getElementById('userInfo').style.display = 'none';
}

// Login functions
function loginAsAdmin() {
    sessionStorage.setItem('loginIntent', 'admin');
    window.location.href = '/auth/google';
}

// Event Listeners
document.addEventListener('DOMContentLoaded', () => {
    checkAuth();
    
    document.getElementById('logoutBtn').addEventListener('click', () => {
        window.location.href = '/auth/logout';
    });
});

