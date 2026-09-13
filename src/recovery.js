const config = require("./config");
const logger = require("./logger");
const state = require("./state");
const ssh = require("./ssh");
const alerter = require("./alerter");

async function recoverService(node, service) {
    const key = `${node.id}:${service.name}`;
    const previous = state.get(key);
    const now = Date.now();

    if (previous && previous.lastRestart &&
        now - previous.lastRestart < config.restartCooldown) {
        logger.warn("Restart suppressed by cooldown", {
            node: node.id,
            service: service.name
        });
        return { ok: false, suppressed: true };
    }

    if (!config.recoveryEnabled) {
        logger.warn("Recovery disabled", {
            node: node.id,
            service: service.name
        });
        return { ok: false, disabled: true };
    }

    logger.warn("Attempting service recovery", {
        node: node.id,
        service: service.name
    });

    const result = await ssh.restartService(
        node,
        service.service,
        config.sshTimeout
    );

    state.update(key, {
        lastRestart: now,
        lastRecoveryOk: result.ok
    });

    if (result.ok) {
        logger.info("Service restart command succeeded", {
            node: node.id,
            service: service.name
        });
        await alerter.sendAlert(
            `RECOVERY ${node.id}/${service.name}`,
            "restart command issued"
        );
    } else {
        logger.error("Service restart failed", {
            node: node.id,
            service: service.name,
            error: result.error
        });
        await alerter.sendAlert(
            `RECOVERY FAILED ${node.id}/${service.name}`,
            result.error || "unknown error"
        );
    }

    return result;
}

module.exports = { recoverService };
