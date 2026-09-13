const { execFile } = require("child_process");

function runSSH(node, command, timeout) {
    return new Promise(resolve => {
        const target = `${node.sshUser}@${node.host}`;
        execFile("ssh", [
            "-o", "BatchMode=yes",
            "-o", `ConnectTimeout=${Math.floor(timeout / 1000)}`,
            "-p", String(node.port || 22),
            target,
            command
        ], { timeout }, (error, stdout, stderr) => {
            if (error) {
                resolve({ ok: false, error: error.message, stdout, stderr });
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
    // exact command must match the sudoers rule on the managed node
    return runSSH(node, `sudo /usr/bin/systemctl restart ${service}`, timeout);
}

async function serviceStatus(node, service, timeout) {
    return runSSH(node, `systemctl is-active ${service}`, timeout);
}

module.exports = { runSSH, checkSSH, restartService, serviceStatus };
