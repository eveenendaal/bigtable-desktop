// Serves the MCP server over Streamable HTTP on the loopback interface, from
// inside the running app. Stateless: every POST gets a fresh server and
// transport, since all tools are plain request/response.
import http from 'node:http';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';

export const MCP_PATH = '/mcp';
export const DEFAULT_MCP_PORT = 8487;
const LOOPBACK_HOSTNAMES = new Set(['localhost', '127.0.0.1', '[::1]']);

/** The URL MCP clients connect to. */
export function mcpUrl(port) {
  return `http://localhost:${port}${MCP_PATH}`;
}

/**
 * Rejects requests a web page could make. A Host other than loopback means DNS
 * rebinding; an Origin header means a browser (MCP clients don't send one).
 * @returns {string|null} why the request is refused, or null to allow it
 */
export function rejectReason(headers) {
  let hostname;
  try {
    hostname = new URL(`http://${headers.host}`).hostname;
  } catch {
    hostname = null;
  }
  if (!LOOPBACK_HOSTNAMES.has(hostname)) return 'Invalid Host header';
  if (headers.origin) return 'Browser requests are not allowed';
  return null;
}

function sendJsonRpcError(res, status, message, extraHeaders = {}) {
  res.writeHead(status, { 'Content-Type': 'application/json', ...extraHeaders });
  res.end(JSON.stringify({ jsonrpc: '2.0', error: { code: -32000, message }, id: null }));
}

/** The request handler, separate from listening so it can be tested on any server. */
export function mcpRequestHandler(createServer) {
  return async (req, res) => {
    const { pathname } = new URL(req.url, 'http://localhost');
    if (pathname !== MCP_PATH) return sendJsonRpcError(res, 404, 'Not found');
    const reason = rejectReason(req.headers);
    if (reason) return sendJsonRpcError(res, 403, reason);
    // No sessions, so there is no standalone SSE stream (GET) or session to end (DELETE).
    if (req.method !== 'POST') return sendJsonRpcError(res, 405, 'Method not allowed', { Allow: 'POST' });

    const server = createServer();
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
    res.on('close', () => {
      transport.close();
      server.close();
    });
    try {
      await server.connect(transport);
      await transport.handleRequest(req, res);
    } catch (err) {
      console.error('MCP request failed', err);
      if (!res.headersSent) sendJsonRpcError(res, 500, 'Internal server error');
    }
  };
}

function listen(server, port, host) {
  return new Promise((resolve, reject) => {
    const onError = (err) => reject(err);
    server.once('error', onError);
    server.listen(port, host, () => {
      server.off('error', onError);
      resolve(server.address().port);
    });
  });
}

/**
 * Starts listening on 127.0.0.1 and, where IPv6 is available, ::1, so
 * "localhost" works whichever address a client resolves it to.
 * @param {{createServer: () => import('@modelcontextprotocol/sdk/server/mcp.js').McpServer, port?: number}} options
 * @returns {Promise<{port: number, url: string, close: () => Promise<void>}>}
 */
export async function startHttpServer({ createServer, port = DEFAULT_MCP_PORT }) {
  const handler = mcpRequestHandler(createServer);
  const servers = [];
  const close = () => Promise.all(servers.map((s) => new Promise((resolve) => s.close(() => resolve())))).then(() => {});
  try {
    const v4 = http.createServer(handler);
    const actualPort = await listen(v4, port, '127.0.0.1');
    servers.push(v4);
    const v6 = http.createServer(handler);
    try {
      await listen(v6, actualPort, '::1');
      servers.push(v6);
    } catch (err) {
      // No IPv6 loopback on this machine: clients will reach 127.0.0.1.
      if (!['EADDRNOTAVAIL', 'EAFNOSUPPORT'].includes(err.code)) throw err;
    }
    return { port: actualPort, url: mcpUrl(actualPort), close };
  } catch (err) {
    await close();
    throw err;
  }
}
