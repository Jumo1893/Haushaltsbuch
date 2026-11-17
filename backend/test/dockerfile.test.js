const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const copied = fs.readFileSync(path.join(root, "Dockerfile"), "utf8").split(/\s+/);

test("Das Dockerfile kopiert alle Module des Backends", () => {
  for (const file of fs.readdirSync(root).filter((f) => f.endsWith(".js"))) {
    assert.ok(copied.includes(file), `${file} fehlt im Dockerfile, das Backend startet sonst nicht`);
  }
});

test("Das Dockerfile kopiert alle Ordner mit Modulen und Importprofilen", () => {
  const folders = fs
    .readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && !["test", "node_modules"].includes(entry.name))
    .map((entry) => entry.name);
  assert.ok(folders.includes("backup"));
  for (const folder of folders) {
    assert.ok(copied.includes(folder), `Der Ordner ${folder} fehlt im Dockerfile, das Backend startet sonst nicht`);
  }
});
