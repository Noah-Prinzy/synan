/**
 * Serves a PGlite instance over TCP on the PostgreSQL wire protocol, so node-postgres (the
 * production driver) can talk to it in tests. One session: connections are served one after
 * another, and a connection that closes inside a transaction has it rolled back.
 */
import { createServer, type Socket } from "node:net";
import type { PGlite } from "@electric-sql/pglite";

const SSL_REQUEST = 80877103;
const CANCEL_REQUEST = 80877102;
const PROTOCOL_3 = 196608;

export interface PgWireServer {
  url: string;
  close(): Promise<void>;
}

export async function servePgWire(db: PGlite, opts: { host?: string; port?: number } = {}): Promise<PgWireServer> {
  await db.waitReady;
  let chain: Promise<unknown> = Promise.resolve();
  const sockets = new Set<Socket>();

  const serve = (socket: Socket) =>
    new Promise<void>((done) => {
      let buf = Buffer.alloc(0);
      let busy = Promise.resolve();
      const finish = () => {
        sockets.delete(socket);
        void busy
          .then(async () => {
            if (db.isInTransaction()) await db.exec("ROLLBACK");
          })
          .catch(() => undefined)
          .finally(done);
      };
      if (socket.destroyed) return finish(); // closed while waiting for its turn
      socket.on("close", finish);
      socket.on("error", () => socket.destroy());
      socket.on("data", (data: Buffer) => {
        buf = Buffer.concat([buf, data]);
        const messages: Buffer[] = [];
        for (;;) {
          if (buf.length < 5) break;
          const first = buf.readInt32BE(0);
          const second = buf.length >= 8 ? buf.readInt32BE(4) : -1;
          if (first === 8 && second === SSL_REQUEST) {
            socket.write("N"); // no TLS
            buf = buf.subarray(8);
            continue;
          }
          if (first === 16 && second === CANCEL_REQUEST) {
            buf = buf.subarray(16); // nothing to cancel in a single session
            continue;
          }
          const len = second === PROTOCOL_3 ? first : 1 + buf.readInt32BE(1); // startup has no type byte
          if (buf.length < len) break;
          messages.push(Buffer.from(buf.subarray(0, len)));
          buf = buf.subarray(len);
        }
        for (const m of messages) {
          busy = busy
            .then(() =>
              db.runExclusive(() =>
                db.execProtocolRawStream(new Uint8Array(m), {
                  onRawData: (out) => {
                    if (out.length && socket.writable) socket.write(out);
                  },
                }),
              ),
            )
            .catch((e: unknown) => {
              console.error("pg-wire: PGlite failed on a protocol message; closing the connection", e);
              socket.destroy(); // a protocol failure ends this connection, not the server
            });
        }
      });
    });

  const server = createServer((socket) => {
    sockets.add(socket);
    socket.pause();
    chain = chain.then(() => {
      socket.resume();
      return serve(socket);
    });
  });
  const host = opts.host ?? "127.0.0.1";
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(opts.port ?? 0, host, () => resolve());
  });
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : opts.port;
  return {
    url: `postgres://postgres:postgres@${host}:${port}/postgres`,
    async close() {
      for (const s of sockets) s.destroy();
      await new Promise<void>((resolve) => server.close(() => resolve()));
      // Let an in-flight message finish, but never hang a test run on it.
      await Promise.race([chain.catch(() => undefined), new Promise((r) => setTimeout(r, 5_000).unref())]);
    },
  };
}
