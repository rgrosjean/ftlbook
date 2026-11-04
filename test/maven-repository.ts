import http from "node:http";
import type net from "node:net";
import { crc32 } from "node:zlib";

/**
 * A Maven repository serving the Base theme jars of a made-up Keycloak version whose fallback
 * Base theme (keycloak.v2) has only the given login.ftl, so tests need no network.
 */
export function startFakeKeycloakRepository(version: string, loginFtl: string) {
  return startMavenRepository({
    [`/org/keycloak/keycloak-themes/${version}/keycloak-themes-${version}.jar`]: zip({
      "theme/keycloak.v2/login/theme.properties": "",
      "theme/keycloak.v2/login/login.ftl": loginFtl,
    }),
    [`/org/keycloak/keycloak-themes-vendor/${version}/keycloak-themes-vendor-${version}.jar`]: zip({
      "theme/keycloak.v2/login/resources/vendor/README": "vendor assets",
    }),
  });
}

/** Serves fixed files by URL path, like a Maven repository. */
export async function startMavenRepository(files: Record<string, Buffer>) {
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
export function zip(entries: Record<string, string>): Buffer {
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
