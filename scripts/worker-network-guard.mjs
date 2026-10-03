import { syncBuiltinESMExports } from "node:module";
import net from "node:net";
import tls from "node:tls";
import http from "node:http";
import https from "node:https";
import http2 from "node:http2";
import dgram from "node:dgram";

// The Agent worker has no provider or MCP network authority. All such calls use
// authenticated daemon IPC. This is a Node API guard, not an OS packet filter.
function denied() {
  throw Error("Agent worker direct network access denied");
}
net.Socket.prototype.connect = denied;
net.connect = denied;
net.createConnection = denied;
tls.connect = denied;
http.request = denied;
http.get = denied;
https.request = denied;
https.get = denied;
http2.connect = denied;
dgram.createSocket = denied;
globalThis.fetch = denied;
if ("WebSocket" in globalThis)
  globalThis.WebSocket = class {
    constructor() {
      denied();
    }
  };
if ("EventSource" in globalThis)
  globalThis.EventSource = class {
    constructor() {
      denied();
    }
  };
syncBuiltinESMExports();
globalThis.__rockyWorkerNetworkGuard = true;
