const fs = require("fs");
const path = require("path");
const config = require("./config");

const stateFile = path.join(config.stateDir, "state.json");
fs.mkdirSync(config.stateDir, { recursive: true });

function load() {
    if (!fs.existsSync(stateFile)) return {};
    try {
        return JSON.parse(fs.readFileSync(stateFile, "utf8"));
    } catch {
        return {};
    }
}

function save(state) {
    const temp = stateFile + ".tmp";
    fs.writeFileSync(temp, JSON.stringify(state, null, 2));
    fs.renameSync(temp, stateFile);
}

function get(key) {
    return load()[key];
}

function set(key, value) {
    const state = load();
    state[key] = value;
    save(state);
}

function update(key, patch) {
    const state = load();
    state[key] = { ...(state[key] || {}), ...patch };
    save(state);
}

module.exports = { load, save, get, set, update };
