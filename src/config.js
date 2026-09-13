const fs = require("fs");
const path = require("path");

function loadEnv(file = path.join(process.cwd(), ".env")) {
    if (!fs.existsSync(file)) return;
    const lines = fs.readFileSync(file, "utf8").split("\n");
    for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith("#")) continue;
        const index = trimmed.indexOf("=");
        if (index === -1) continue;
        const key = trimmed.slice(0, index).trim();
        const value = trimmed.slice(index + 1).trim();
        if (!process.env[key]) process.env[key] = value;
    }
}

loadEnv();

const rootDir = path.resolve(__dirname, "..");

const config = {
    nodeId: process.env.NODE_ID || "atom5",
    role: process.env.MONITOR_ROLE || "watchdog",

    host: process.env.MONITOR_HOST || "0.0.0.0",
    port: Number(process.env.MONITOR_PORT || 8500),

    token: process.env.RELAY_TOKEN || "",

    checkInterval:
        Number(process.env.CHECK_INTERVAL_SECONDS || 30) * 1000,

    sshTimeout:
        Number(process.env.SSH_TIMEOUT_SECONDS || 10) * 1000,

    recoveryEnabled:
        String(process.env.RECOVERY_ENABLED || "false").toLowerCase() === "true",

    restartCooldown:
        Number(process.env.RESTART_COOLDOWN_SECONDS || 300) * 1000,

    alertsEnabled:
        String(process.env.ALERTS_ENABLED || "false").toLowerCase() === "true",

    alertThrottleMs:
        Number(process.env.ALERT_THROTTLE_SECONDS || 900) * 1000,

    relayHost: process.env.RELAY_HOST || "",
    relayPort: Number(process.env.RELAY_PORT || 8400),

    rootDir,
    dataDir: path.join(rootDir, "data"),
    logsDir: path.join(rootDir, "data", "logs"),
    stateDir: path.join(rootDir, "data", "state"),

    nodesFile: path.join(rootDir, "config", "nodes.json")
};

module.exports = config;
