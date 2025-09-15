// UI utility functions and helpers
class UIUtils {
    static formatPrice(price) {
        if (!price) return 'No price';
        
        // Handle different price formats
        if (typeof price === 'string') {
            return price;
        }
        
        if (typeof price === 'object') {
            if (price.amount && price.currency) {
                return `${price.amount} ${price.currency}`;
            }
        }
        
        return price.toString();
    }

    static formatTime(timestamp) {
        if (!timestamp) return 'Unknown time';
        
        const date = new Date(timestamp);
        const now = new Date();
        const diff = now - date;
        
        // Less than 1 minute
        if (diff < 60000) {
            return 'Just now';
        }
        
        // Less than 1 hour
        if (diff < 3600000) {
            const minutes = Math.floor(diff / 60000);
            return `${minutes} minute${minutes > 1 ? 's' : ''} ago`;
        }
        
        // Less than 1 day
        if (diff < 86400000) {
            const hours = Math.floor(diff / 3600000);
            return `${hours} hour${hours > 1 ? 's' : ''} ago`;
        }
        
        // More than 1 day
        return date.toLocaleDateString();
    }

    static formatNumber(num) {
        if (num >= 1000000) {
            return (num / 1000000).toFixed(1) + 'M';
        }
        if (num >= 1000) {
            return (num / 1000).toFixed(1) + 'K';
        }
        return num.toString();
    }

    static debounce(func, wait) {
        let timeout;
        return function executedFunction(...args) {
            const later = () => {
                clearTimeout(timeout);
                func(...args);
            };
            clearTimeout(timeout);
            timeout = setTimeout(later, wait);
        };
    }

    static throttle(func, limit) {
        let inThrottle;
        return function() {
            const args = arguments;
            const context = this;
            if (!inThrottle) {
                func.apply(context, args);
                inThrottle = true;
                setTimeout(() => inThrottle = false, limit);
            }
        };
    }

    static showLoading(element) {
        if (element) {
            element.innerHTML = '<div class="loading"></div>';
            element.disabled = true;
        }
    }

    static hideLoading(element, originalText) {
        if (element) {
            element.innerHTML = originalText;
            element.disabled = false;
        }
    }

    static createElement(tag, className, content) {
        const element = document.createElement(tag);
        if (className) {
            element.className = className;
        }
        if (content) {
            element.innerHTML = content;
        }
        return element;
    }

    static addEventListeners(element, events) {
        Object.entries(events).forEach(([event, handler]) => {
            element.addEventListener(event, handler);
        });
    }

    static removeEventListeners(element, events) {
        Object.entries(events).forEach(([event, handler]) => {
            element.removeEventListener(event, handler);
        });
    }
}

// Modal management
class ModalManager {
    constructor() {
        this.activeModal = null;
        this.setupGlobalListeners();
    }

    setupGlobalListeners() {
        // Close modal on escape key
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' && this.activeModal) {
                this.close(this.activeModal);
            }
        });

        // Close modal on backdrop click
        document.addEventListener('click', (e) => {
            if (e.target.classList.contains('modal') && this.activeModal) {
                this.close(this.activeModal);
            }
        });
    }

    open(modalId) {
        const modal = document.getElementById(modalId);
        if (modal) {
            modal.classList.add('active');
            this.activeModal = modalId;
            document.body.style.overflow = 'hidden';
            
            // Focus first input in modal
            const firstInput = modal.querySelector('input, select, textarea');
            if (firstInput) {
                setTimeout(() => firstInput.focus(), 100);
            }
        }
    }

    close(modalId) {
        const modal = document.getElementById(modalId);
        if (modal) {
            modal.classList.remove('active');
            this.activeModal = null;
            document.body.style.overflow = '';
        }
    }

    closeAll() {
        document.querySelectorAll('.modal.active').forEach(modal => {
            modal.classList.remove('active');
        });
        this.activeModal = null;
        document.body.style.overflow = '';
    }
}

// Notification system
class NotificationManager {
    constructor() {
        this.notifications = [];
        this.maxNotifications = 5;
        this.defaultDuration = 5000;
    }

    show(message, type = 'info', duration = this.defaultDuration) {
        const notification = this.createNotification(message, type);
        document.body.appendChild(notification);
        
        this.notifications.push(notification);
        
        // Remove oldest notifications if we exceed the limit
        if (this.notifications.length > this.maxNotifications) {
            const oldest = this.notifications.shift();
            if (oldest.parentNode) {
                oldest.parentNode.removeChild(oldest);
            }
        }

        // Auto remove after duration
        if (duration > 0) {
            setTimeout(() => {
                this.remove(notification);
            }, duration);
        }

        return notification;
    }

    createNotification(message, type) {
        const notification = UIUtils.createElement('div', `notification ${type}`);
        
        const icon = this.getIcon(type);
        notification.innerHTML = `
            <div class="notification-content">
                <i class="fas fa-${icon}"></i>
                <span>${message}</span>
                <button class="notification-close" onclick="this.parentElement.parentElement.remove()">
                    <i class="fas fa-times"></i>
                </button>
            </div>
        `;

        return notification;
    }

    getIcon(type) {
        const icons = {
            success: 'check-circle',
            error: 'exclamation-circle',
            warning: 'exclamation-triangle',
            info: 'info-circle'
        };
        return icons[type] || 'info-circle';
    }

    remove(notification) {
        if (notification.parentNode) {
            notification.parentNode.removeChild(notification);
        }
        
        const index = this.notifications.indexOf(notification);
        if (index > -1) {
            this.notifications.splice(index, 1);
        }
    }

    clear() {
        this.notifications.forEach(notification => {
            if (notification.parentNode) {
                notification.parentNode.removeChild(notification);
            }
        });
        this.notifications = [];
    }
}

// Form validation
class FormValidator {
    static validateEmail(email) {
        const re = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        return re.test(email);
    }

    static validateRequired(value) {
        return value && value.trim().length > 0;
    }

    static validateMinLength(value, minLength) {
        return value && value.length >= minLength;
    }

    static validateMaxLength(value, maxLength) {
        return value && value.length <= maxLength;
    }

    static validateNumber(value, min = null, max = null) {
        const num = parseFloat(value);
        if (isNaN(num)) return false;
        if (min !== null && num < min) return false;
        if (max !== null && num > max) return false;
        return true;
    }

    static validateForm(form, rules) {
        const errors = {};
        
        Object.entries(rules).forEach(([fieldName, fieldRules]) => {
            const field = form.querySelector(`[name="${fieldName}"]`);
            if (!field) return;
            
            const value = field.value;
            
            fieldRules.forEach(rule => {
                if (!rule.validator(value)) {
                    if (!errors[fieldName]) {
                        errors[fieldName] = [];
                    }
                    errors[fieldName].push(rule.message);
                }
            });
        });
        
        return {
            isValid: Object.keys(errors).length === 0,
            errors
        };
    }

    static showFieldError(field, message) {
        this.clearFieldError(field);
        
        const errorElement = UIUtils.createElement('div', 'field-error', message);
        field.parentNode.appendChild(errorElement);
        field.classList.add('error');
    }

    static clearFieldError(field) {
        const errorElement = field.parentNode.querySelector('.field-error');
        if (errorElement) {
            errorElement.remove();
        }
        field.classList.remove('error');
    }
}

// Data table management
class DataTable {
    constructor(container, options = {}) {
        this.container = container;
        this.options = {
            sortable: true,
            filterable: true,
            searchable: true,
            pagination: false,
            pageSize: 50,
            ...options
        };
        this.data = [];
        this.filteredData = [];
        this.sortColumn = null;
        this.sortDirection = 'asc';
        this.currentPage = 1;
        this.searchTerm = '';
    }

    setData(data) {
        this.data = data;
        this.filteredData = [...data];
        this.render();
    }

    addRow(rowData) {
        this.data.unshift(rowData);
        this.filteredData.unshift(rowData);
        this.render();
    }

    removeRow(id) {
        this.data = this.data.filter(row => row.id !== id);
        this.filteredData = this.filteredData.filter(row => row.id !== id);
        this.render();
    }

    updateRow(id, rowData) {
        const index = this.data.findIndex(row => row.id === id);
        if (index > -1) {
            this.data[index] = { ...this.data[index], ...rowData };
        }
        
        const filteredIndex = this.filteredData.findIndex(row => row.id === id);
        if (filteredIndex > -1) {
            this.filteredData[filteredIndex] = { ...this.filteredData[filteredIndex], ...rowData };
        }
        
        this.render();
    }

    sort(column, direction = 'asc') {
        this.sortColumn = column;
        this.sortDirection = direction;
        
        this.filteredData.sort((a, b) => {
            const aVal = a[column];
            const bVal = b[column];
            
            if (aVal < bVal) return direction === 'asc' ? -1 : 1;
            if (aVal > bVal) return direction === 'asc' ? 1 : -1;
            return 0;
        });
        
        this.render();
    }

    filter(column, value) {
        if (!value) {
            this.filteredData = [...this.data];
        } else {
            this.filteredData = this.data.filter(row => 
                row[column] && row[column].toString().toLowerCase().includes(value.toLowerCase())
            );
        }
        this.render();
    }

    search(term) {
        this.searchTerm = term;
        
        if (!term) {
            this.filteredData = [...this.data];
        } else {
            this.filteredData = this.data.filter(row => 
                Object.values(row).some(value => 
                    value && value.toString().toLowerCase().includes(term.toLowerCase())
                )
            );
        }
        this.render();
    }

    render() {
        // This would be implemented based on specific table requirements
        // For now, just clear and show filtered data count
        this.container.innerHTML = `
            <div class="table-info">
                Showing ${this.filteredData.length} of ${this.data.length} items
            </div>
        `;
    }
}

// Initialize global UI managers
document.addEventListener('DOMContentLoaded', () => {
    window.modalManager = new ModalManager();
    window.notificationManager = new NotificationManager();
});

// Export utilities for use in other modules
window.UIUtils = UIUtils;
window.FormValidator = FormValidator;
window.DataTable = DataTable;
