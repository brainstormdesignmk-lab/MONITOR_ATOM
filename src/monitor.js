const http = require("http");
const fs = require("fs");

const config = require("./config");
const logger = require("./logger");
const checker = require("./checker");
const ssh = require("./ssh");
const recovery = require("./recovery");
const alerter = require("./alerter");

function loadNodes() {
    if (!fs.existsSync(config.nodesFile)) {
        throw new Error(`Missing ${config.nodesFile}`);
    }
    const data = JSON.parse(fs.readFileSync(config.nodesFile, "utf8"));
    return data.nodes || [];
}

// reloadable: editing nodes.json no longer requires a restart
let nodes = loadNodes();

fs.watchFile(config.nodesFile, { interval: 5000 }, () => {
    try {
        nodes = loadNodes();
        logger.info("nodes.json reloaded", { count: nodes.length });
    } catch (error) {
        logger.error("Failed to reload nodes.json", { error: error.message });
    }
});

const clusterState = {
    startedAt: new Date().toISOString(),
    lastCheck: null,
    nodes: {}
};

async function checkNode(node) {
    logger.info("Checking node", { node: node.id, host: node.host });

    const sshResult = await ssh.checkSSH(node, config.sshTimeout);

    if (!sshResult.ok) {
        const wasOnline = clusterState.nodes[node.id] &&
            clusterState.nodes[node.id].online;

        clusterState.nodes[node.id] = {
            online: false,
            ssh: false,
            services: {}
        };

        logger.error("Node SSH unreachable", {
            node: node.id,
            error: sshResult.error
        });

        // alert only on transition to offline, not every cycle
        if (wasOnline !== false) {
            await alerter.sendAlert(
                `NODE OFFLINE ${node.id}`,
                `SSH unreachable: ${sshResult.error}`
            );
        }
        return;
    }

    const result = { online: true, ssh: true, services: {} };

    // check all services on this node concurrently
    await Promise.all((node.services || []).map(async service => {
        if (service.health !== "http") return;

        const health = await checker.checkHttp(
            node.host,
            service.healthPort,
            service.healthPath,
            5000,
            service.requiresToken ? config.token : ""
        );

        result.services[service.name] = {
            ok: health.ok,
            statusCode: health.statusCode,
            responseTime: health.responseTime,
            error: health.error
        };

        if (health.ok) {
            logger.info("Service healthy", {
                node: node.id,
                service: service.name,
                responseTime: health.responseTime
            });
        } else {
            logger.warn("Service unhealthy", {
                node: node.id,
                service: service.name,
                error: health.error
            });
            await recovery.recoverService(node, service);
        }
    }));

    clusterState.nodes[node.id] = result;
}

async function checkCluster() {
    logger.info("Starting cluster check");
    clusterState.lastCheck = new Date().toISOString();

    // all nodes concurrently — one slow node can no longer stall the cycle
    await Promise.allSettled(nodes.map(node => checkNode(node)));

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

    await checkCluster();

    setInterval(() => {
        if (busy) return;
        busy = true;
        checkCluster()
            .catch(error => {
                logger.error("Cluster check crashed", { error: error.message });
            })
            .finally(() => { busy = false; });
    }, config.checkInterval);
}

process.on("SIGTERM", () => { logger.info("Monitor stopping"); process.exit(0); });
process.on("SIGINT", () => { logger.info("Monitor stopping"); process.exit(0); });

main().catch(error => {
    logger.error("Monitor failed to start", { error: error.message });
    process.exit(1);
});
