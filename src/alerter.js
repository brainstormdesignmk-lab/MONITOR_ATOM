const http = require("http");
const config = require("./config");
const logger = require("./logger");
const state = require("./state");

function sendToRelay(payload) {
    return new Promise(resolve => {
        const body = JSON.stringify(payload);
        const req = http.request({
            hostname: config.relayHost,
            port: config.relayPort,
            path: "/outbound",
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "X-Relay-Token": config.token,
                "Content-Length": Buffer.byteLength(body)
            },
            timeout: 10000
        }, res => {
            res.resume();
            res.on("end", () => resolve({ ok: res.statusCode < 300 }));
        });
        req.on("timeout", () => { req.destroy(); resolve({ ok: false }); });
        req.on("error", error => resolve({ ok: false, error: error.message }));
        req.write(body);
        req.end();
    });
}

async function sendAlert(subject, text) {
    if (!config.alertsEnabled) return;
    if (!config.relayHost) {
        logger.warn("Alert suppressed: RELAY_HOST not configured", { subject });
        return;
    }

    // throttle per subject so a dead node doesn't spam every cycle
    const key = `alert:${subject}`;
    const previous = state.get(key);
    const now = Date.now();
    if (previous && previous.lastSent &&
        now - previous.lastSent < config.alertThrottleMs) {
        return;
    }

    const result = await sendToRelay({
        platform: "alert",
        account: "watchdog",
        recipient: "admin",
        text: `[${config.nodeId}] ${subject}: ${text}`
    });

    state.update(key, {
        lastSent: now,
        delivered: result.ok
    });

    if (result.ok) {
        logger.info("Alert sent", { subject });
    } else {
        logger.error("Alert delivery failed", { subject });
    }
}

module.exports = { sendAlert };
