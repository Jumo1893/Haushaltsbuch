const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");

test("Das Dockerfile kopiert alle Module des Backends", () => {
  const copied = fs.readFileSync(path.join(root, "Dockerfile"), "utf8").split(/\s+/);
  for (const file of fs.readdirSync(root).filter((f) => f.endsWith(".js"))) {
    assert.ok(copied.includes(file), `${file} fehlt im Dockerfile, das Backend startet sonst nicht`);
  }
});
