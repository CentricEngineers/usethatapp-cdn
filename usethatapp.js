// javascript
/* jshint esversion: 8 */
/* global ResizeObserver */

(function () {
    'use strict';

    const parentOrigin = "http://localhost:8000"; // Update to match the trusted parent origin

    // Restore handshake flag from sessionStorage (persists across same-origin iframe navigations)
    let handshakeComplete = sessionStorage.getItem('handshakeComplete') === '1';

    function setHandshakeComplete(value) {
        handshakeComplete = !!value;
        sessionStorage.setItem('handshakeComplete', handshakeComplete ? '1' : '0');
    }

    function clearHandshake() {
        handshakeComplete = false;
        sessionStorage.removeItem('handshakeComplete');
    }

    /**
     * Responds to messages from the parent window.
     */
    function handleHandshakeMessage(event) {
        if (event.origin !== parentOrigin) {
            return;
        }

        const msg = event.data || {};

        switch (msg.type) {
            case 'nonce':
                // Acknowledge nonce to complete handshake
                window.parent.postMessage({
                    type: 'nonce-ack',
                    nonce: msg.nonce
                }, parentOrigin);
                setHandshakeComplete(true);
                break;
            case 'clear-handshake':
                // parent requested we drop the handshake flag (logout / revoke)
                clearHandshake();
                break;
            default:
                // Handle other post-handshake messages if needed
                break;
        }
    }

    // Expose a Dash clientside function that requests access level from the parent.
    // Attach it to window.dash_clientside.clientside.requestAccessLevel
    window.dash_clientside = Object.assign({}, window.dash_clientside, {
        clientside: {
            requestAccessLevel: async function (n_clicks, timeout = 10000) {
                if (!handshakeComplete) {
                    return Promise.reject(new Error('handshake not complete'));
                }

                const requestId = `${Date.now()}-${Math.random().toString(36).slice(2)}`;

                return new Promise((resolve, reject) => {
                    let timeoutId = null;

                    function onMessage(event) {
                        if (event.origin !== parentOrigin) {
                            return;
                        }

                        const msg = event.data || {};
                        // Match responses that explicitly reference our request id
                        if (msg.responseTo === requestId) {
                            window.removeEventListener('message', onMessage, false);
                            if (timeoutId !== null) {
                                clearTimeout(timeoutId);
                            }
                            resolve(msg);
                        } else {
                            reject(new Error('requestId does not match'));
                        }
                    }

                    // Listen for the parent's response
                    window.addEventListener('message', onMessage, false);

                    // Send request with correlation id
                    try {
                        window.parent.postMessage({
                            type: 'request-level',
                            requestId: requestId
                        }, parentOrigin);
                    } catch (err) {
                        window.removeEventListener('message', onMessage, false);
                        return reject(err);
                    }

                    // Timeout handling
                    timeoutId = setTimeout(() => {
                        window.removeEventListener('message', onMessage, false);
                        reject(new Error('requestAccessLevel timed out'));
                    }, timeout);
                });
            }
        }
    });

    // Listen for messages from parent
    window.addEventListener('message', handleHandshakeMessage, false);

    // Throttle resize notifications to avoid rapid firing
    let resizeTimeout;

    function notifyResize() {
        if (!handshakeComplete) {
            return;
        }
        clearTimeout(resizeTimeout);
        resizeTimeout = setTimeout(() => {
            let contentHeight = document.body.scrollHeight;
            window.parent.postMessage({
                type: 'reset-height',
                height: contentHeight
            }, parentOrigin);
        }, 100); // Debounce time in ms
    }

    // Call notifyResize whenever the content changes size
    window.addEventListener('DOMContentLoaded', notifyResize, false);

    // Watch for DOM mutations and signal resize
    let observer = new MutationObserver(notifyResize);
    observer.observe(document.body, {childList: true, subtree: true});

    // Watch for changes to children's size and signal resize (guard ResizeObserver)
    if (typeof ResizeObserver !== 'undefined') {
        let resizeObserver = new ResizeObserver(notifyResize);
        for (const child of document.children) {
            resizeObserver.observe(child);
        }
    }

    // Ensure the handshake flag is cleared when this browsing context unloads
    window.addEventListener('beforeunload', () => {
        clearHandshake();
    }, false);

    window.addEventListener('pagehide', () => {
        clearHandshake();
    }, false);
})();
