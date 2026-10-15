const http = require("http");
const fs = require("fs");

const config = require("./config");
const logger = require("./logger");
const checker = require("./checker");
const metricsCollector = require("./metrics");

function loadNodes() {
    if (!fs.existsSync(config.nodesFile)) {
        throw new Error(`Missing ${config.nodesFile}`);
    }
    const data = JSON.parse(fs.readFileSync(config.nodesFile, "utf8"));
    if (!data || !Array.isArray(data.nodes) || data.nodes.length === 0) {
        throw new Error("nodes.json must contain a non-empty nodes array");
    }
    const ids = new Set();
    data.nodes.forEach(node => {
        if (!node || !/^[A-Za-z0-9_-]+$/.test(node.id || "") || !node.host || !node.sshUser) {
            throw new Error("Each node requires a simple id, host, and sshUser");
        }
        if (ids.has(node.id)) throw new Error("Duplicate node id: " + node.id);
        ids.add(node.id);
        if (node.port != null && (!Number.isInteger(node.port) || node.port < 1 || node.port > 65535)) {
            throw new Error("Invalid SSH port for " + node.id);
        }
        if (node.services != null && !Array.isArray(node.services)) {
            throw new Error("services must be an array for " + node.id);
        }
    });
    return data.nodes;
}

// reloadable: editing nodes.json no longer requires a restart
let nodes = loadNodes();

fs.watchFile(config.nodesFile, { interval: 5000 }, () => {
    try {
        nodes = loadNodes();
        const validIds = new Set(nodes.map(node => node.id));
        Object.keys(clusterState.nodes).forEach(id => {
            if (!validIds.has(id)) delete clusterState.nodes[id];
        });
        logger.info("nodes.json reloaded", { count: nodes.length });
    } catch (error) {
        logger.error("Failed to reload nodes.json", { error: error.message });
    }
});

const clusterState = {
    startedAt: new Date().toISOString(),
    lastCheck: null,
    checkDurationMs: null,
    nodes: {}
};

const priorCpu = {};

function cpuPercent(previous, current) {
    if (!previous || !current || current.length < 4) return null;
    const idleNow = current[3] + (current[4] || 0);
    const idleBefore = previous[3] + (previous[4] || 0);
    const totalNow = current.reduce((sum, n) => sum + n, 0);
    const totalBefore = previous.reduce((sum, n) => sum + n, 0);
    const elapsed = totalNow - totalBefore;
    if (elapsed <= 0) return null;
    return Math.round(1000 * (1 - (idleNow - idleBefore) / elapsed)) / 10;
}

function summarizeMetrics(id, raw) {
    const oldCounters = priorCpu[id];
    const cpu = cpuPercent(oldCounters, raw.cpuCounters);
    priorCpu[id] = raw.cpuCounters;
    const memory = raw.memory && raw.memory.totalKb > 0 ? {
        totalKb: raw.memory.totalKb,
        usedKb: raw.memory.totalKb - raw.memory.availableKb,
        availableKb: raw.memory.availableKb,
        usedPercent: Math.round(1000 * (raw.memory.totalKb - raw.memory.availableKb) / raw.memory.totalKb) / 10
    } : null;
    return {
        cpuPercent: cpu,
        memory,
        temperatureC: raw.temperatures.length ? Math.max.apply(null, raw.temperatures) : null,
        temperaturesC: raw.temperatures,
        disks: raw.disks,
        interfaces: raw.interfaces
    };
}

async function checkNode(node) {
    const started = Date.now();
    const prior = clusterState.nodes[node.id] || {};
    clusterState.nodes[node.id] = Object.assign({}, prior, {
        id: node.id, host: node.host, role: node.role || "machine",
        checking: true, lastCheck: new Date().toISOString()
    });
    let collected;
    try {
        collected = await metricsCollector.collect(node, config.metricsTimeout);
    } catch (error) {
        collected = { ok: false, error: error.message };
    }
    const result = {
        id: node.id, host: node.host, role: node.role || "machine",
        online: collected.ok, ssh: node.local ? null : collected.ok,
        checking: false, lastCheck: new Date().toISOString(),
        responseTimeMs: Date.now() - started,
        error: collected.ok ? null : collected.error,
        metrics: collected.ok ? summarizeMetrics(node.id, collected.metrics) : null,
        services: prior.services || {}
    };

    if (!collected.ok) {
        if (prior.online !== false) {
            logger.warn("Node unavailable", { node: node.id, host: node.host, error: collected.error });
        }
    } else if (prior.online !== true) {
        logger.info("Node available", { node: node.id, host: node.host });
    }

    await Promise.all((node.services || []).map(async service => {
        if (service.health !== "http") return;
        const health = await checker.checkHttp(node.host, service.healthPort, service.healthPath, 5000,
            service.requiresToken ? config.token : "");
        result.services[service.name] = {
            ok: health.ok, statusCode: health.statusCode,
            responseTime: health.responseTime, error: health.error
        };
    }));
    clusterState.nodes[node.id] = result;
}

async function checkCluster() {
    const started = Date.now();
    logger.info("Starting cluster check");
    clusterState.lastCheck = new Date().toISOString();

    // all nodes concurrently — one slow node can no longer stall the cycle
    const results = await Promise.allSettled(nodes.map(node => checkNode(node)));
    results.forEach((result, index) => {
        if (result.status === "rejected") {
            const node = nodes[index];
            clusterState.nodes[node.id] = {
                id: node.id, host: node.host, role: node.role || "machine",
                online: false, checking: false, lastCheck: new Date().toISOString(),
                error: result.reason && result.reason.message || "check failed", metrics: null
            };
            logger.error("Node check failed", { node: node.id, error: clusterState.nodes[node.id].error });
        }
    });
    clusterState.checkDurationMs = Date.now() - started;
    logger.info("Cluster check complete");
}

function createServer() {
    const server = http.createServer((req, res) => {
        if (req.method === "GET" && req.url === "/health") {
            res.writeHead(200, { "Content-Type": "application/json" });
            res.end(JSON.stringify({
                ok: true,
                node: config.nodeId,
                role: config.role
            }));
            return;
        }

        if (req.method === "GET" && req.url === "/status") {
            res.writeHead(200, { "Content-Type": "application/json" });
            res.end(JSON.stringify(clusterState, null, 2));
            return;
        }

        res.writeHead(404, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Not found" }));
    });

    server.listen(config.port, config.host, () => {
        logger.info("Metropolis Monitor started", {
            host: config.host,
            port: config.port,
            interval: config.checkInterval
        });
    });

    return server;
}

let busy = false;

async function main() {
    createServer();
    const run = async () => {
        if (busy) return;
        busy = true;
        return checkCluster()
            .catch(error => {
                logger.error("Cluster check crashed", { error: error.message });
            })
            .finally(() => { busy = false; });
    };
    await run();
    setInterval(run, config.checkInterval);
}

process.on("SIGTERM", () => { logger.info("Monitor stopping"); process.exit(0); });
process.on("SIGINT", () => { logger.info("Monitor stopping"); process.exit(0); });

main().catch(error => {
    logger.error("Monitor failed to start", { error: error.message });
    process.exit(1);
});
