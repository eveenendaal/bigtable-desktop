// How MCP clients launch Bigtable Desktop's MCP server, and how the app registers
// it with the Claude Code CLI. No Electron imports, so it can be unit tested.
import { execFile } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export const MCP_SERVER_NAME = 'bigtable-desktop';

/**
 * The stdio launch command: the app's own binary in Node mode running src/mcp/stdio.js.
 * @param {{execPath: string, scriptPath: string}} paths
 */
export function launchConfig({ execPath, scriptPath }) {
  return { command: execPath, args: [scriptPath], env: { ELECTRON_RUN_AS_NODE: '1' } };
}

/** Arguments for `claude mcp add`, registering the server for every project (user scope). */
export function claudeAddArgs(config) {
  const env = Object.entries(config.env).flatMap(([key, value]) => ['-e', `${key}=${value}`]);
  return ['mcp', 'add', MCP_SERVER_NAME, '--scope', 'user', ...env, '--', config.command, ...config.args];
}

export function shellQuote(arg) {
  return /^[\w@%+=:,./-]+$/.test(arg) ? arg : `'${arg.replace(/'/g, `'\\''`)}'`;
}

/** The `claude mcp add` command as one copy-pasteable line. */
export function claudeAddCommand(config) {
  return ['claude', ...claudeAddArgs(config)].map(shellQuote).join(' ');
}

/** `mcpServers` JSON for clients configured with a file (Claude Desktop, .mcp.json, ...). */
export function mcpServersJson(config) {
  return JSON.stringify({ mcpServers: { [MCP_SERVER_NAME]: { type: 'stdio', ...config } } }, null, 2);
}

const run = (file, args, options = {}) =>
  new Promise((resolve) => {
    execFile(file, args, { timeout: 20_000, ...options }, (error, stdout, stderr) => {
      resolve({ ok: !error, code: error?.code ?? 0, stdout: String(stdout), stderr: String(stderr) });
    });
  });

/**
 * GUI apps on macOS don't inherit the shell's PATH, so the `claude` CLI (and the
 * `node` an npm install of it needs) may not be found. Ask the login shell.
 */
export async function shellEnv() {
  if (process.platform === 'win32') return process.env;
  const shell = process.env.SHELL || (process.platform === 'darwin' ? '/bin/zsh' : '/bin/sh');
  const marker = '__BIGTABLE_DESKTOP_PATH__';
  const { stdout } = await run(shell, ['-ilc', `printf '\\n${marker}%s\\n' "$PATH"`], { timeout: 8000 });
  const line = stdout.split('\n').find((l) => l.startsWith(marker));
  const shellPath = line?.slice(marker.length);
  return shellPath ? { ...process.env, PATH: [shellPath, process.env.PATH].filter(Boolean).join(path.delimiter) } : process.env;
}

/** Finds the Claude Code CLI. Returns its path, or null. */
export function findClaude(env, home = os.homedir()) {
  const names = process.platform === 'win32' ? ['claude.exe', 'claude.cmd', 'claude'] : ['claude'];
  const dirs = [...(env.PATH || '').split(path.delimiter), path.join(home, '.claude', 'local'), path.join(home, '.local', 'bin')];
  for (const dir of dirs.filter(Boolean)) {
    for (const name of names) {
      const candidate = path.join(dir, name);
      try {
        fs.accessSync(candidate, fs.constants.X_OK);
        if (fs.statSync(candidate).isFile()) return candidate;
      } catch {
        // Not here.
      }
    }
  }
  return null;
}

/** Registers (or re-registers) the server with Claude Code at user scope. */
export async function installInClaude(config) {
  const env = await shellEnv();
  const claude = findClaude(env);
  if (!claude) return { ok: false, message: 'The Claude Code CLI (claude) was not found. Install Claude Code, or run the command shown below.' };
  // Remove any previous registration first so paths stay current after the app moves or updates.
  await run(claude, ['mcp', 'remove', MCP_SERVER_NAME, '--scope', 'user'], { env });
  const added = await run(claude, claudeAddArgs(config), { env });
  return {
    ok: added.ok,
    claude,
    message: added.ok ? added.stdout.trim() || `Added ${MCP_SERVER_NAME} to Claude Code.` : (added.stderr || added.stdout).trim() || `claude exited with ${added.code}`,
  };
}
