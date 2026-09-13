const test = require("node:test");
const assert = require("node:assert");
const alerter = require("../src/alerter");

test("alerter exports sendAlert", () => {
    assert.strictEqual(typeof alerter.sendAlert, "function");
});
