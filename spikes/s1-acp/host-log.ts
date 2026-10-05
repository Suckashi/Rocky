// A CONNECT proxy on 127.0.0.1 that records every host a child process reaches.
// OpenCode is a compiled binary, so this is how Rocky sees its outbound traffic.
// When the parent itself sits behind a proxy (HTTPS_PROXY), tunnels are chained to it.
import { createServer, type Server } from 'node:http';
import { connect, type Socket } from 'node:net';
import type { AddressInfo } from 'node:net';

export interface HostLog {
  url: string;
  hosts: Set<string>;
  close(): Promise<void>;
}

function tunnelVia(upstream: URL, target: string): Promise<Socket> {
  return new Promise((resolve, reject) => {
    const socket = connect(Number(upstream.port || 80), upstream.hostname);
    socket.once('error', reject);
    socket.once('connect', () => {
      socket.write(`CONNECT ${target} HTTP/1.1\r\nHost: ${target}\r\n\r\n`);
    });
    let head = '';
    const onData = (chunk: Buffer) => {
      head += chunk.toString('latin1');
      const end = head.indexOf('\r\n\r\n');
      if (end === -1) return;
      socket.off('data', onData);
      if (!/^HTTP\/1\.[01] 200/.test(head)) {
        socket.destroy();
        reject(new Error(head.split('\r\n')[0]));
        return;
      }
      const rest = Buffer.from(head.slice(end + 4), 'latin1');
      if (rest.length) socket.unshift(rest);
      resolve(socket);
    };
    socket.on('data', onData);
  });
}

function direct(target: string): Promise<Socket> {
  const [host = '', port = '443'] = target.split(/:(?=\d+$)/);
  return new Promise((resolve, reject) => {
    const socket = connect(Number(port), host, () => resolve(socket));
    socket.once('error', reject);
  });
}

export async function startHostLog(upstream?: string): Promise<HostLog> {
  const hosts = new Set<string>();
  const sockets = new Set<Socket>();
  const server: Server = createServer((_req, res) => {
    // Plain-HTTP proxying is not needed: the child reaches 127.0.0.1 directly (NO_PROXY).
    res.writeHead(405).end();
  });
  server.on('connect', (req, client: Socket) => {
    const target = req.url ?? '';
    hosts.add(target.replace(/:443$/, ''));
    sockets.add(client);
    client.on('close', () => sockets.delete(client));
    const open = upstream
      ? tunnelVia(new URL(upstream), target)
      : direct(target);
    open.then(
      (remote) => {
        sockets.add(remote);
        remote.on('close', () => sockets.delete(remote));
        client.write('HTTP/1.1 200 Connection Established\r\n\r\n');
        remote.pipe(client).on('error', () => client.destroy());
        client.pipe(remote).on('error', () => remote.destroy());
        remote.on('error', () => client.destroy());
        client.on('error', () => remote.destroy());
      },
      () => {
        client.end('HTTP/1.1 502 Bad Gateway\r\n\r\n');
      },
    );
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${port}`,
    hosts,
    close: () =>
      new Promise((resolve) => {
        for (const socket of sockets) socket.destroy();
        server.close(() => resolve());
      }),
  };
}
