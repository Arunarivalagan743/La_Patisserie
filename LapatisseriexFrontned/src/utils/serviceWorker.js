/**
 * Service Worker Registration and Management
 * Handles registration, updates, and communication with service worker
 */

// Check if service workers are supported
const isSwSupported = () => 'serviceWorker' in navigator;

// Register service worker
export const registerServiceWorker = async () => {
  if (!isSwSupported()) {
    console.log('Service Workers are not supported');
    return false;
  }

  try {
    const registration = await navigator.serviceWorker.register('/sw.js', {
      scope: '/'
    });

    console.log('Service Worker registered successfully:', registration.scope);

    // Handle service worker updates
    registration.addEventListener('updatefound', () => {
      const newWorker = registration.installing;
      
      if (newWorker) {
        newWorker.addEventListener('statechange', () => {
          if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
            // New service worker is available
            console.log('New service worker available');
            
            // Optionally show update notification to user
            showUpdateNotification(registration);
          }
        });
      }
    });

    // Listen for controlling service worker changes
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      console.log('Service worker controller changed');
      window.location.reload();
    });

    return registration;
  } catch (error) {
    console.error('Service Worker registration failed:', error);
    return false;
  }
};

// Show update notification (optional)
const showUpdateNotification = (registration) => {
  // You can integrate this with your toast notification system
  const updateAvailable = confirm(
    'A new version of La Patisserie is available. Would you like to update now?'
  );
  
  if (updateAvailable && registration.waiting) {
    registration.waiting.postMessage({ type: 'SKIP_WAITING' });
  }
};

// Unregister service worker (for development/testing)
export const unregisterServiceWorker = async () => {
  if (!isSwSupported()) {
    return false;
  }

  try {
    const registration = await navigator.serviceWorker.getRegistration();
    if (registration) {
      await registration.unregister();
      console.log('Service Worker unregistered');
      return true;
    }
  } catch (error) {
    console.error('Service Worker unregistration failed:', error);
  }
  
  return false;
};

// Check if app is running in standalone mode (PWA)
export const isStandalone = () => {
  return window.matchMedia('(display-mode: standalone)').matches || 
         window.navigator.standalone || 
         document.referrer.includes('android-app://');
};

// Get service worker registration
export const getServiceWorkerRegistration = async () => {
  if (!isSwSupported()) {
    return null;
  }

  try {
    return await navigator.serviceWorker.getRegistration();
  } catch (error) {
    console.error('Failed to get service worker registration:', error);
    return null;
  }
};

// Send message to service worker
export const sendMessageToServiceWorker = (message) => {
  if (navigator.serviceWorker.controller) {
    navigator.serviceWorker.controller.postMessage(message);
  }
};

// Initialize service worker when app loads
export const initializeServiceWorker = () => {
  if (process.env.NODE_ENV === 'production') {
    registerServiceWorker();
  } else {
    console.log('Service Worker registration skipped in development mode');
  }
};