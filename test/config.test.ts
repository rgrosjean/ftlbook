import { test } from "node:test";
import assert from "node:assert/strict";
import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import http from "node:http";
import net from "node:net";
import { crc32 } from "node:zlib";
import os from "node:os";
import path from "node:path";
import { startServer, fixture } from "./harness.ts";

/** A writable copy of a fixture project, removed after the test. */
async function copyProject(t: { after: (fn: () => Promise<void>) => void }, name: string): Promise<string> {
  const project = await mkdtemp(path.join(os.tmpdir(), "ftl-preview-project-"));
  t.after(() => rm(project, { recursive: true, force: true }));
  await cp(fixture(name), project, { recursive: true });
  return project;
}

/** Merges settings into the project's ftl-preview.json. */
async function configure(project: string, settings: Record<string, unknown>) {
  const file = path.join(project, "ftl-preview.json");
  const current = JSON.parse(await readFile(file, "utf8").catch(() => "{}"));
  await writeFile(file, JSON.stringify({ ...current, ...settings }));
}

async function freePort(): Promise<number> {
  const server = net.createServer();
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as net.AddressInfo;
  await new Promise((resolve) => server.close(resolve));
  return port;
}

test("the config file's Theme directory, stories directory and port are honored", async (t) => {
  const project = await copyProject(t, "configured-project");
  const port = await freePort();
  await configure(project, { port });

  const server = await startServer(project, { port: null });
  t.after(() => server.stop());
  assert.equal(server.baseUrl, `http://localhost:${port}`);

  const res = await fetch(`${server.baseUrl}/preview/login/login.ftl/OtherRealm`);
  const html = await res.text();
  assert.equal(res.status, 200, html);
  assert.match(html, /<p id="configured-theme">Configured Theme for configuredrealm<\/p>/);
});

test("a Theme type other than login is rejected with a clear message", async (t) => {
  const project = await copyProject(t, "configured-project");
  await configure(project, { themeType: "account" });

  await assert.rejects(startServer(project), /server exited with 1:[\s\S]*Theme type "account" is not supported; supported: login/);
});

test("the config's strict flag set to false turns on lenient mode", async (t) => {
  const project = await copyProject(t, "story-project");
  await configure(project, { strict: false });

  const server = await startServer(project);
  t.after(() => server.stop());
  // WithoutRealm deletes a key the Base theme's template.ftl requires: an error in strict mode
  const res = await fetch(`${server.baseUrl}/preview/login/login.ftl/WithoutRealm`);
  assert.equal(res.status, 200, await res.text());
});

test("a configured Keycloak version downloads and uses that version's Base theme", async (t) => {
  // A made-up Keycloak version, served by a local Maven repository, so the test needs no network
  const mirror = await startMavenRepository({
    "/org/keycloak/keycloak-themes/99.0.0/keycloak-themes-99.0.0.jar": zip({
      "theme/keycloak.v2/login/theme.properties": "",
      "theme/keycloak.v2/login/login.ftl": '<html lang="${lang}"><p id="base-theme">Keycloak 99 Base theme</p></html>',
    }),
    "/org/keycloak/keycloak-themes-vendor/99.0.0/keycloak-themes-vendor-99.0.0.jar": zip({
      "theme/keycloak.v2/login/resources/vendor/README": "vendor assets",
    }),
  });
  t.after(() => mirror.close());
  const cacheDir = await mkdtemp(path.join(os.tmpdir(), "ftl-preview-cache-"));
  t.after(() => rm(cacheDir, { recursive: true, force: true }));
  const project = await copyProject(t, "empty-project");
  await configure(project, { keycloakVersion: "99.0.0", mavenRepository: mirror.url });

  const server = await startServer(project, { cacheDir });
  t.after(() => server.stop());
  assert.match(server.output(), /Downloading Base theme for Keycloak 99\.0\.0/);
  const html = await (await fetch(`${server.baseUrl}/preview/login/login.ftl/Default`)).text();
  assert.match(html, /<p id="base-theme">Keycloak 99 Base theme<\/p>/);
});

/** Serves fixed files by URL path, like a Maven repository. */
async function startMavenRepository(files: Record<string, Buffer>) {
  const server = http.createServer((req, res) => {
    const file = files[req.url ?? ""];
    if (!file) return void res.writeHead(404).end();
    res.writeHead(200, { "content-type": "application/java-archive" }).end(file);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as net.AddressInfo;
  return {
    url: `http://127.0.0.1:${port}`,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

/** A minimal zip (jar) archive with uncompressed entries. */
function zip(entries: Record<string, string>): Buffer {
  const local: Buffer[] = [];
  const central: Buffer[] = [];
  let offset = 0;
  for (const [name, text] of Object.entries(entries)) {
    const nameBytes = Buffer.from(name);
    const data = Buffer.from(text);
    const header = Buffer.alloc(30);
    header.writeUInt32LE(0x04034b50, 0);
    header.writeUInt16LE(20, 4);
    header.writeUInt32LE(crc32(data), 14);
    header.writeUInt32LE(data.length, 18);
    header.writeUInt32LE(data.length, 22);
    header.writeUInt16LE(nameBytes.length, 26);
    const entry = Buffer.alloc(46);
    entry.writeUInt32LE(0x02014b50, 0);
    entry.writeUInt16LE(20, 4);
    entry.writeUInt16LE(20, 6);
    entry.writeUInt32LE(crc32(data), 16);
    entry.writeUInt32LE(data.length, 20);
    entry.writeUInt32LE(data.length, 24);
    entry.writeUInt16LE(nameBytes.length, 28);
    entry.writeUInt32LE(offset, 42);
    local.push(header, nameBytes, data);
    central.push(entry, nameBytes);
    offset += header.length + nameBytes.length + data.length;
  }
  const centralSize = central.reduce((n, b) => n + b.length, 0);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(central.length / 2, 8);
  end.writeUInt16LE(central.length / 2, 10);
  end.writeUInt32LE(centralSize, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...local, ...central, end]);
}
