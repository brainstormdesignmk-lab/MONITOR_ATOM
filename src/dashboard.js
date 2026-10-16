const http = require("http");
const readline = require("readline");
const fs = require("fs");
const config = require("./config");
const ssh = require("./ssh");

const host = process.env.MONITOR_HOST || "127.0.0.1";
const port = Number(process.env.MONITOR_PORT || 8500);
const interval = Number(process.env.DASHBOARD_REFRESH_SECONDS || 5) * 1000;
let selected = 0;
let scroll = 0;
let followSelection = true;
let latest = null;
let lastError = "waiting for monitor";
let stopped = false;
let actionFocus = 0;
let confirmation = null;
let actionBusy = false;
let actionMessage = "";
const pendingActions = new Map();
const verificationTimeout = 120000;

const ACTIONS = [null, "reboot", "shutdown"];
const inventory = JSON.parse(fs.readFileSync(config.nodesFile, "utf8")).nodes || [];
const inventoryById = new Map(inventory.map(node => [node.id, node]));

function getStatus() {
    return new Promise((resolve, reject) => {
        const request = http.get({ host, port, path: "/status", timeout: 4000 }, response => {
            let body = "";
            response.setEncoding("utf8");
            response.on("data", chunk => { body += chunk; });
            response.on("end", () => {
                if (response.statusCode !== 200) return reject(new Error("HTTP " + response.statusCode));
                try { resolve(JSON.parse(body)); } catch (error) { reject(error); }
            });
        });
        request.on("timeout", () => request.destroy(new Error("request timeout")));
        request.on("error", reject);
    });
}

function human(kb) {
    if (!Number.isFinite(kb)) return "?";
    const gb = kb / 1024 / 1024;
    return gb >= 1 ? gb.toFixed(1) + "G" : Math.round(kb / 1024) + "M";
}

function pct(value) { return value == null ? "  --" : String(value.toFixed(1)).padStart(5); }
function fit(value, width) { return String(value == null ? "" : value).slice(0, width).padEnd(width); }
function addDetail(content, label, value, width) {
    const prefix = "      " + label + ": ";
    const available = Math.max(20, width - prefix.length);
    const chunks = String(value || "--").split(/(?<=; )/);
    let line = "";
    chunks.forEach(chunk => {
        if (line.length && line.length + chunk.length > available) {
            content.push({ text: prefix + line, sub: true });
            line = "";
        }
        while (chunk.length > available) {
            if (line) {
                content.push({ text: prefix + line, sub: true });
                line = "";
            }
            content.push({ text: prefix + chunk.slice(0, available), sub: true });
            chunk = chunk.slice(available);
        }
        line += chunk;
    });
    if (line) {
        content.push({ text: prefix + line, sub: true });
    }
}

function render() {
    if (stopped) return;
    const width = process.stdout.columns || 100;
    const height = process.stdout.rows || 28;
    const nodes = latest ? Object.keys(latest.nodes || {}).map(key => latest.nodes[key]) : [];
    nodes.sort((a, b) => a.id.localeCompare(b.id));
    if (selected >= nodes.length) selected = Math.max(0, nodes.length - 1);
    const lines = [];
    const title = " METROPOLIS CLUSTER WATCH  |  " + new Date().toLocaleString();
    lines.push("\x1b[1;36m" + title.slice(0, width).padEnd(width) + "\x1b[0m");
    lines.push("Monitor check: " + (latest && latest.lastCheck || "waiting") +
        "   cycle " + (latest && latest.checkDurationMs != null ? latest.checkDurationMs + "ms" : "--") +
        "   refresh " + (interval / 1000) + "s");
    lines.push("─".repeat(Math.max(0, width)));
    lines.push("   NODE    ROLE         ADDRESS         STATE   CPU%  TEMP   RAM USED / FREE");
    lines.push("─".repeat(Math.max(0, width)));

    const content = [];
    const nodeLineIndices = [];
    nodes.forEach((node, index) => {
        nodeLineIndices[index] = content.length;
        const m = node.metrics || {};
        const mem = m.memory ? `${human(m.memory.usedKb)} / ${human(m.memory.availableKb)} free (${m.memory.usedPercent.toFixed(0)}%)` : "--";
        const diskSummary = (m.disks || []).map(d => {
            const total = Number(d.totalKb), used = Number(d.usedKb), free = Number(d.availableKb);
            const percent = total ? Math.round(100 * used / total) : 0;
            return `${d.mount} ${human(used)}/${human(total)} free ${human(free)} ${percent}%`;
        }).join("; ") || "--";
        const status = node.checking ? "CHECKING" : node.online ? "UP" : "SSH DOWN";
        const controls = index === selected
            ? `  ${actionFocus === 1 ? "[ REBOOT ]" : " REBOOT  "} ${actionFocus === 2 ? "[ SHUTDOWN ]" : " SHUTDOWN "}`
            : "";
        const row = width < 120
            ? `${index === selected ? ">" : " "} ${fit(node.id, 6)} ${fit(node.host, 15)} ${fit(node.online ? "UP" : node.checking ? "CHECK" : "DOWN", 5)} C:${pct(m.cpuPercent).trim()}% T:${m.temperatureC == null ? "--" : m.temperatureC.toFixed(0)}C R:${m.memory ? human(m.memory.usedKb) + "/" + human(m.memory.availableKb) : "--"}${controls}`
            : `${index === selected ? ">" : " "} ${fit(node.id, 7)} ${fit(node.role, 12)} ${fit(node.host, 15)} ${fit(status, 7)} ${pct(m.cpuPercent)} ${m.temperatureC == null ? " -- " : String(m.temperatureC.toFixed(1)).padStart(5)} ${fit(mem, 22)}${controls}`;
        content.push({ text: row, selected: index === selected, node, control: index === selected && actionFocus > 0 });
        addDetail(content, "DISK", diskSummary, width);
        const interfaces = m.interfaces || [];
        const network = interfaces.length ? interfaces.map(i => `${i.name} ${i.address} (${i.state})`).join(", ") : (node.online ? "No IPv4 interface reported" : (node.error || "SSH metrics unavailable"));
        addDetail(content, "LAN", network, width);
    });

    const available = Math.max(1, height - 10);
    const selectedLine = nodeLineIndices[selected] || 0;
    if (followSelection) {
        if (selectedLine < scroll) scroll = selectedLine;
        if (selectedLine >= scroll + available) scroll = selectedLine - available + 1;
    }
    if (scroll > Math.max(0, content.length - available)) scroll = Math.max(0, content.length - available);
    content.slice(scroll, scroll + available).forEach(item => {
        let text = item.text.slice(0, width).padEnd(width);
        const rowColor = item.selected
            ? "\x1b[1;36m"
            : item.node && item.node.online ? "\x1b[1;32m" : item.node ? "\x1b[31m" : "";
        if (item.control) {
            const button = item.text.indexOf(actionFocus === 1 ? "[ REBOOT ]" : "[ SHUTDOWN ]");
            const end = button < 0 ? -1 : button + (actionFocus === 1 ? 10 : 12);
            text = rowColor + text.slice(0, Math.max(0, button)) + "\x1b[0m" +
                "\x1b[1;30;43m" + text.slice(Math.max(0, button), end) + "\x1b[0m" +
                rowColor + text.slice(end) + "\x1b[0m";
        } else if (rowColor) text = rowColor + text + "\x1b[0m";
        lines.push(text);
    });
    while (lines.length < height - 3) lines.push("");
    lines.push("─".repeat(Math.max(0, width)));
    if (confirmation) {
        lines.push(`Confirm ${confirmation.action.toUpperCase()} ${confirmation.node.id} (${confirmation.node.host})?  y = confirm  n/Esc = cancel`);
    } else if (actionBusy) {
        lines.push("Sending power command; the SSH connection may close if the machine acts on it...");
    } else {
        lines.push("↑/↓ machine  → actions  ← specs  Enter execute  PgUp/PgDn scroll  r refresh  q quit");
    }
    if (actionMessage || lastError) lines.push((actionMessage || "Status: " + lastError).slice(0, width));
    process.stdout.write("\x1b[H\x1b[2J" + lines.slice(0, height).join("\n"));
}

function updatePendingActions(status) {
    const states = status && status.nodes || {};
    const now = Date.now();
    for (const [id, pending] of pendingActions) {
        const node = states[id];
        const checkedAt = node && Date.parse(node.lastCheck || "");
        if (node && Number.isFinite(checkedAt) && checkedAt >= pending.sentAt) {
            if (pending.action === "reboot") {
                if (!node.online) {
                    pending.sawOffline = true;
                    actionMessage = `REBOOT sent to ${id}; machine is offline, waiting for it to return...`;
                } else if (pending.sawOffline) {
                    pendingActions.delete(id);
                    actionMessage = `REBOOT verified: ${id} is reachable again.`;
                    continue;
                }
            } else if (!node.online) {
                pendingActions.delete(id);
                actionMessage = `SHUTDOWN observed: ${id} is no longer reachable over SSH.`;
                continue;
            }
        }
        if (now - pending.sentAt >= verificationTimeout) {
            pendingActions.delete(id);
            actionMessage = pending.action === "reboot"
                ? pending.sawOffline
                    ? `REBOOT not verified: ${id} has not returned within two minutes.`
                    : `REBOOT not verified: ${id} never appeared offline within two minutes.`
                : `SHUTDOWN not observed: ${id} is still reachable or has no fresh check.`;
        }
    }
}

async function executePowerAction(action) {
    const node = inventoryById.get(confirmation.node.id);
    const target = confirmation.node;
    confirmation = null;
    if (!node) {
        actionMessage = "No inventory entry for " + target.id;
        render();
        return;
    }
    actionBusy = true;
    actionMessage = "Sending " + action + " to " + target.id + "...";
    render();
    const sentAt = Date.now();
    const result = await ssh.powerAction(node, action, 12000);
    actionBusy = false;
    if (result.ok) {
        pendingActions.set(target.id, { action, sentAt, sawOffline: false });
        actionMessage = action === "reboot"
            ? `REBOOT accepted by ${target.id}; watching for it to go offline and return.`
            : `SHUTDOWN accepted by ${target.id}; watching for it to become unreachable.`;
    } else {
        actionMessage = `${action.toUpperCase()} failed for ${target.id}: ${result.error || "unknown error"}`;
    }
    render();
}

async function refresh() {
    try {
        latest = await getStatus();
        lastError = "";
        updatePendingActions(latest);
    }
    catch (error) { lastError = error.message; }
    render();
}

function stop() {
    if (stopped) return;
    stopped = true;
    if (process.stdin.isTTY) process.stdin.setRawMode(false);
    process.stdin.pause();
    process.stdout.write("\x1b[?25h\x1b[?1049l\n");
    process.exit(0);
}

if (!process.stdin.isTTY || !process.stdout.isTTY) {
    console.error("Run this dashboard in an interactive terminal (SSH with -t).");
    process.exit(2);
}
process.stdout.write("\x1b[?1049h\x1b[?25l\x1b[2J");
readline.emitKeypressEvents(process.stdin);
process.stdin.setRawMode(true);
process.stdin.resume();
process.stdin.on("keypress", (str, key) => {
    if (confirmation) {
        if (str && str.toLowerCase() === "y") executePowerAction(confirmation.action);
        else if (str && str.toLowerCase() === "n" || key && key.name === "escape") {
            confirmation = null;
            actionMessage = "Power action cancelled.";
            render();
        }
        return;
    }
    if (key && (key.name === "q" || key.ctrl && key.name === "c")) return stop();
    const count = latest ? Object.keys(latest.nodes || {}).length : 0;
    if (key && key.name === "up") { selected = Math.max(0, selected - 1); actionFocus = 0; followSelection = true; actionMessage = ""; }
    if (key && key.name === "down") { selected = Math.min(Math.max(0, count - 1), selected + 1); actionFocus = 0; followSelection = true; actionMessage = ""; }
    if (key && key.name === "right") actionFocus = Math.min(2, actionFocus + 1);
    if (key && key.name === "left") actionFocus = Math.max(0, actionFocus - 1);
    if (key && key.name === "return" && actionFocus > 0 && !actionBusy) {
        const node = latest && latest.nodes && latest.nodes[Object.keys(latest.nodes).sort()[selected]];
        if (node) {
            if (pendingActions.has(node.id)) {
                actionMessage = `Waiting for ${node.id}'s previous power action to be verified.`;
            } else {
                confirmation = { action: ACTIONS[actionFocus], node };
                actionMessage = "";
            }
        }
    }
    if (key && key.name === "pageup") { scroll = Math.max(0, scroll - 8); followSelection = false; }
    if (key && key.name === "pagedown") { scroll += 8; followSelection = false; }
    if (str === "r") refresh();
    else render();
});
process.stdout.on("resize", render);
process.on("SIGTERM", stop);
process.on("SIGINT", stop);
refresh();
setInterval(refresh, interval);
