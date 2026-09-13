const fs = require("fs");
const path = require("path");
const config = require("./config");

fs.mkdirSync(config.logsDir, { recursive: true });

const logFile = path.join(config.logsDir, "monitor.log");
const MAX_LOG_SIZE = 5 * 1024 * 1024;

function rotateIfNeeded() {
    try {
        const stat = fs.statSync(logFile);
        if (stat.size > MAX_LOG_SIZE) {
            fs.renameSync(logFile, logFile + ".1");
        }
    } catch (_) {}
}

function write(level, message, extra = {}) {
    const entry = {
        timestamp: new Date().toISOString(),
        level,
        node: config.nodeId,
        message,
        ...extra
    };
    const line = JSON.stringify(entry);
    console.log(line);
    try {
        rotateIfNeeded();
        fs.appendFileSync(logFile, line + "\n");
    } catch (_) {}
}

module.exports = {
    info(message, extra) { write("INFO", message, extra); },
    warn(message, extra) { write("WARN", message, extra); },
    error(message, extra) { write("ERROR", message, extra); }
};
