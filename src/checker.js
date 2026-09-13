const http = require("http");

function checkHttp(host, port, pathName, timeout = 5000, token = "") {
    return new Promise(resolve => {
        const started = Date.now();
        const headers = {};
        if (token) headers["X-Relay-Token"] = token;

        const req = http.request({
            host, port, path: pathName, method: "GET",
            headers, timeout
        }, res => {
            let body = "";
            res.on("data", chunk => { body += chunk; });
            res.on("end", () => {
                resolve({
                    ok: res.statusCode >= 200 && res.statusCode < 300,
                    statusCode: res.statusCode,
                    responseTime: Date.now() - started,
                    body
                });
            });
        });

        req.on("timeout", () => {
            req.destroy();
            resolve({ ok: false, error: "timeout", responseTime: Date.now() - started });
        });

        req.on("error", error => {
            resolve({ ok: false, error: error.message, responseTime: Date.now() - started });
        });

        req.end();
    });
}

module.exports = { checkHttp };
