const test = require("node:test");
const assert = require("node:assert");
const state = require("../src/state");

test("state module exports required functions", () => {
    assert.strictEqual(typeof state.get, "function");
    assert.strictEqual(typeof state.set, "function");
    assert.strictEqual(typeof state.update, "function");
});
