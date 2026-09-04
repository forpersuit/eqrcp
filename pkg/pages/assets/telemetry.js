/**
 * EQT Mobile Client Telemetry Probe (Native Lightweight JS)
 * Zero-dependency, non-blocking telemetry reporter using sendBeacon and fetch keepalive.
 */
(function(window) {
    'use strict';

    if (window.__eqt_telemetry) {
        return;
    }

    function getOrCreateClientID() {
        try {
            var id = window.sessionStorage.getItem('eqt_telemetry_client_id');
            if (!id) {
                var legacy = window.localStorage.getItem('eqt_client_id');
                if (legacy && legacy.length >= 6) {
                    var parts = legacy.split('_');
                    id = parts[parts.length - 1].slice(-6);
                }
                if (!id || id.length < 4) {
                    id = Math.random().toString(36).substring(2, 8);
                }
                window.sessionStorage.setItem('eqt_telemetry_client_id', id);
            }
            return id;
        } catch (e) {
            return Math.random().toString(36).substring(2, 8);
        }
    }

    function reportLog(level, category, message, details) {
        try {
            var payload = {
                client_id: getOrCreateClientID(),
                timestamp: Date.now(),
                level: String(level || 'INFO').toUpperCase(),
                category: String(category || 'CLIENT_EVENT').toUpperCase(),
                message: String(message || '').slice(0, 256),
                details: details || {}
            };

            var jsonStr = JSON.stringify(payload);
            var blob = new Blob([jsonStr], { type: 'application/json' });

            if (navigator.sendBeacon) {
                navigator.sendBeacon('/client-log', blob);
            } else if (window.fetch) {
                fetch('/client-log', {
                    method: 'POST',
                    body: blob,
                    keepalive: true,
                    headers: { 'Content-Type': 'application/json' }
                }).catch(function() {});
            } else {
                var xhr = new XMLHttpRequest();
                xhr.open('POST', '/client-log', true);
                xhr.setRequestHeader('Content-Type', 'application/json');
                xhr.send(jsonStr);
            }
        } catch (err) {
            // Silently swallow any telemetry error - never disrupt user experience
        }
    }

    window.__eqt_telemetry = {
        report: reportLog,
        getClientID: getOrCreateClientID
    };

    // Auto-capture uncaught runtime errors
    window.addEventListener('error', function(e) {
        try {
            var filename = e.filename ? e.filename.split('/').pop() : '';
            reportLog('ERROR', 'EXCEPTION', e.message || 'Uncaught JavaScript Error', {
                file: filename,
                line: e.lineno || 0,
                col: e.colno || 0
            });
        } catch (err) {}
    });

    // Auto-capture unhandled promise rejections
    window.addEventListener('unhandledrejection', function(e) {
        try {
            var reason = e.reason;
            var msg = (reason && (reason.message || String(reason))) || 'Unhandled Promise Rejection';
            reportLog('ERROR', 'EXCEPTION', msg);
        } catch (err) {}
    });

    // Auto-capture offline / online connectivity transitions
    window.addEventListener('offline', function() {
        reportLog('WARN', 'NETWORK_OFFLINE', 'Browser network disconnected (offline)');
    });

    window.addEventListener('online', function() {
        reportLog('INFO', 'NETWORK_ONLINE', 'Browser network reconnected (online)');
    });
})(window);
