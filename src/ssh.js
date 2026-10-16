const { execFile } = require("child_process");
const config = require("./config");

const POWER_COMMANDS = {
    reboot: "sudo -n /sbin/reboot",
    shutdown: "sudo -n /sbin/poweroff"
};

function runSSH(node, command, timeout) {
    return new Promise(resolve => {
        const target = `${node.sshUser}@${node.host}`;
        const args = [
            "-o", "BatchMode=yes",
            "-o", "ConnectTimeout=" + Math.max(1, Math.ceil(timeout / 1000)),
            "-o", "ConnectionAttempts=1",
            "-o", "StrictHostKeyChecking=yes",
            "-o", "ServerAliveInterval=3",
            "-o", "ServerAliveCountMax=1",
            "-o", "IdentitiesOnly=yes",
            "-i", node.identityFile || config.sshKeyFile,
            "-p", String(node.port || 22),
            target,
            command
        ];
        execFile("ssh", args, { timeout, maxBuffer: 1024 * 1024 }, (error, stdout, stderr) => {
            if (error) {
                const detail = (stderr || "").trim();
                const message = detail || (error.killed
                    ? "SSH command timed out"
                    : error.code != null ? "SSH exited with code " + error.code : error.message);
                resolve({ ok: false, error: message, stdout, stderr });
                return;
            }
            resolve({ ok: true, stdout, stderr });
        });
    });
}

async function checkSSH(node, timeout) {
    return runSSH(node, "printf MONITOR_SSH_OK", timeout);
}

async function restartService(node, service, timeout) {
    // Service names are configuration, but still restrict them to systemd-safe characters.
    if (!/^[A-Za-z0-9_.@:-]+$/.test(service)) {
        return { ok: false, error: "Invalid service name" };
    }
    return runSSH(node, `sudo /usr/bin/systemctl restart ${service}`, timeout);
}

async function serviceStatus(node, service, timeout) {
    if (!/^[A-Za-z0-9_.@:-]+$/.test(service)) {
        return { ok: false, error: "Invalid service name" };
    }
    return runSSH(node, `systemctl is-active ${service}`, timeout);
}

function runLocalPowerAction(action, timeout) {
    const args = ["-n", action === "reboot" ? "/sbin/reboot" : "/sbin/poweroff"];
    return new Promise(resolve => {
        execFile("sudo", args, { timeout }, (error, stdout, stderr) => {
            if (error) {
                resolve({ ok: false, error: (stderr || "").trim() || error.message, stdout, stderr });
            } else {
                resolve({ ok: true, stdout, stderr });
            }
        });
    });
}

function powerAction(node, action, timeout) {
    const command = POWER_COMMANDS[action];
    if (!command) return Promise.resolve({ ok: false, error: "Unsupported power action" });
    // Atom6 is the dashboard host, so use its local sudo rather than requiring
    // its outbound SSH key to be authorized on itself.
    return node.local ? runLocalPowerAction(action, timeout) : runSSH(node, command, timeout);
}

module.exports = { runSSH, checkSSH, restartService, serviceStatus, powerAction };
