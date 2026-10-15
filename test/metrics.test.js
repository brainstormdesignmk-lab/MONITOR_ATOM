const test = require("node:test");
const assert = require("node:assert");
const metrics = require("../src/metrics");

test("metrics script loads and parser reads host resources", () => {
    assert.match(metrics.SCRIPT, /\/sys\/class\/net/);
    const parsed = metrics.parse([
        "cpu\t100 20 30 400 10 0 0 0",
        "memory\t8000000\t3000000",
        "temp\t51.5",
        "disk\t/dev/sda1\t1000000\t250000\t750000\t/",
        "iface\teth0\t192.168.1.16\tactive"
    ].join("\n"));

    assert.deepStrictEqual(parsed.cpuCounters, [100, 20, 30, 400, 10, 0, 0, 0]);
    assert.deepStrictEqual(parsed.memory, { totalKb: 8000000, availableKb: 3000000 });
    assert.deepStrictEqual(parsed.temperatures, [51.5]);
    assert.deepStrictEqual(parsed.disks[0], {
        filesystem: "/dev/sda1", totalKb: 1000000, usedKb: 250000,
        availableKb: 750000, mount: "/"
    });
    assert.deepStrictEqual(parsed.interfaces[0], {
        name: "eth0", address: "192.168.1.16", state: "active"
    });
});
