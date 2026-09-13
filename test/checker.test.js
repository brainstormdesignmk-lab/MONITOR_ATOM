const test = require("node:test");
const assert = require("node:assert");
const checker = require("../src/checker");

test("checker exports checkHttp", () => {
    assert.strictEqual(typeof checker.checkHttp, "function");
});
