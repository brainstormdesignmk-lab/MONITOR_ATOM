const http = require("http");
const readline = require("readline");

const host = process.env.MONITOR_HOST || "127.0.0.1";
const port = Number(process.env.MONITOR_PORT || 8500);
const interval = Number(process.env.DASHBOARD_REFRESH_SECONDS || 5) * 1000;
let selected = 0;
let scroll = 0;
let followSelection = true;
let latest = null;
let lastError = "waiting for monitor";
let stopped = false;

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
        const row = width < 100
            ? `${index === selected ? ">" : " "} ${fit(node.id, 6)} ${fit(node.host, 15)} ${fit(node.online ? "UP" : node.checking ? "CHECK" : "DOWN", 5)} CPU:${pct(m.cpuPercent).trim()}% TEMP:${m.temperatureC == null ? "--" : m.temperatureC.toFixed(1)}C RAM:${m.memory ? human(m.memory.usedKb) + "/" + human(m.memory.availableKb) : "--"}`
            : `${index === selected ? ">" : " "} ${fit(node.id, 7)} ${fit(node.role, 12)} ${fit(node.host, 15)} ${fit(status, 7)} ${pct(m.cpuPercent)} ${m.temperatureC == null ? " -- " : String(m.temperatureC.toFixed(1)).padStart(5)} ${fit(mem, 22)}`;
        content.push({ text: row, selected: index === selected, node });
        addDetail(content, "DISK", diskSummary, width);
        const interfaces = m.interfaces || [];
        const network = interfaces.length ? interfaces.map(i => `${i.name} ${i.address} (${i.state})`).join(", ") : (node.online ? "No IPv4 interface reported" : (node.error || "SSH metrics unavailable"));
        addDetail(content, "LAN", network, width);
    });

    const available = Math.max(1, height - 9);
    const selectedLine = nodeLineIndices[selected] || 0;
    if (followSelection) {
        if (selectedLine < scroll) scroll = selectedLine;
        if (selectedLine >= scroll + available) scroll = selectedLine - available + 1;
    }
    if (scroll > Math.max(0, content.length - available)) scroll = Math.max(0, content.length - available);
    content.slice(scroll, scroll + available).forEach(item => {
        let text = item.text.slice(0, width).padEnd(width);
        if (item.selected) text = "\x1b[1;32m" + text + "\x1b[0m";
        else if (!item.sub && item.node && !item.node.online) text = "\x1b[31m" + text + "\x1b[0m";
        lines.push(text);
    });
    while (lines.length < height - 2) lines.push("");
    lines.push("─".repeat(Math.max(0, width)));
    lines.push("↑/↓ select  PgUp/PgDn scroll  r refresh  q quit   " + (lastError ? "Status: " + lastError : "All status data current"));
    process.stdout.write("\x1b[H" + lines.slice(0, height).join("\n"));
}

async function refresh() {
    try { latest = await getStatus(); lastError = ""; }
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
    if (key && (key.name === "q" || key.ctrl && key.name === "c")) return stop();
    const count = latest ? Object.keys(latest.nodes || {}).length : 0;
    if (key && key.name === "up") { selected = Math.max(0, selected - 1); followSelection = true; }
    if (key && key.name === "down") { selected = Math.min(Math.max(0, count - 1), selected + 1); followSelection = true; }
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
