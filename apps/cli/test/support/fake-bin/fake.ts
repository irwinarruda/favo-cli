import { execSync, spawnSync } from 'node:child_process';
import { appendFileSync, copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';

const [name, ...args] = process.argv.slice(2);
const home = process.env.HOME ?? '';
const isWindows = process.platform === 'win32';
const UsageResetMs = 44.5 * 60_000;

async function claudeUsage() {
  for await (const line of console) {
    const { request, request_id } = JSON.parse(line);
    const answer = (response: unknown) =>
      console.log(JSON.stringify({ type: 'control_response', response: { subtype: 'success', request_id, response } }));
    if (request.subtype === 'initialize') answer({});
    if (request.subtype !== 'get_usage') continue;
    if (process.env.FAKE_USAGE_HANG) await Bun.sleep(60_000);
    const isSubscription = process.env.ANTHROPIC_API_KEY === undefined && readdirSync('.').length === 0;
    const resets_at = new Date(Date.now() + UsageResetMs).toISOString().replace('Z', '000+00:00');
    answer({
      rate_limits_available: isSubscription,
      rate_limits: { five_hour: { utilization: 32, resets_at }, cinder_cove: null },
    });
  }
}

function claude() {
  const folder = process.env.CLAUDE_CONFIG_DIR ?? `${home}/.claude`;
  if (args[0] === '--version') {
    console.log('2.1.316 (Claude Code)');
    return;
  }
  if (args[0] === 'update') {
    console.log('fake claude updating');
    return;
  }
  if (args[0] === 'auth' && args[1] === 'status') {
    if (!existsSync(`${folder}/identity`)) {
      console.log('{"loggedIn":false}');
      process.exit(1);
    }
    const email = readFileSync(`${folder}/identity`, 'utf8').trim();
    console.log(JSON.stringify({ loggedIn: true, email, subscriptionType: 'max' }));
    return;
  }
  if (args.includes('--input-format')) return claudeUsage();
  if (args[0] === 'auth' && args[1] === 'login') {
    mkdirSync(folder, { recursive: true });
    writeFileSync(`${folder}/identity`, 'signed-in@bee.dev');
    console.log(`fake claude signed in at ${folder}`);
    return;
  }
  console.log(
    `fake claude cwd=${process.cwd().replaceAll('\\', '/')} home=${folder} args=${args.join(' ')} tmux=${process.env.TMUX ?? 'none'} term=${process.env.TERM ?? 'none'}`
  );
  runSessionHooks(folder);
  process.exit(3);
}

function runSessionHooks(folder: string) {
  const id = process.env.FAKE_SESSION;
  if (!id || !existsSync(`${folder}/settings.json`)) return;
  const transcript = `${folder}/projects/${id}.jsonl`;
  if (!process.env.FAKE_EMPTY_SESSION) {
    mkdirSync(`${folder}/projects`, { recursive: true });
    writeFileSync(transcript, '{}');
  }
  const payload = JSON.stringify({
    session_id: id,
    transcript_path: transcript,
    cwd: process.cwd(),
    source: process.env.FAKE_SESSION_SOURCE ?? 'startup',
  });
  const { hooks } = JSON.parse(readFileSync(`${folder}/settings.json`, 'utf8'));
  for (const group of hooks?.SessionStart ?? []) {
    for (const hook of group.hooks) {
      const stdout = execSync(hook.command, { input: payload, stdio: ['pipe', 'pipe', 'pipe'] }).toString();
      if (stdout !== '') console.log(`hook wrote to the conversation: ${stdout}`);
    }
  }
}

async function codex() {
  const folder = process.env.CODEX_HOME ?? `${home}/.codex`;
  const versionFile = process.env.FAKE_CODEX_VERSION_FILE;
  if (args[0] === '--version') {
    console.log(`codex-cli ${versionFile ? readFileSync(versionFile, 'utf8') : '0.1.0'}`);
    return;
  }
  if (args[0] === 'update') {
    console.log('fake codex updating');
    if (versionFile) writeFileSync(versionFile, '0.2.0');
    return;
  }
  if (process.env.FAKE_CODEX_HOLD) {
    while (!existsSync(process.env.FAKE_CODEX_HOLD)) await Bun.sleep(25);
    return;
  }
  if (args[0] !== 'app-server') {
    console.log(`fake codex home=${folder} args=${args.join(' ')}`);
    return;
  }
  for await (const line of console) {
    if (line.includes('"id":1')) console.log('{"id":1,"result":{}}');
    if (line.includes('account/read')) {
      const hasIdentity = existsSync(`${folder}/identity`);
      const account = hasIdentity
        ? { type: 'chatgpt', email: readFileSync(`${folder}/identity`, 'utf8').trim(), planType: 'plus' }
        : null;
      console.log(JSON.stringify({ id: 2, result: { account } }));
    }
    if (line.includes('account/rateLimits/read')) {
      const resetsAt = Math.floor((Date.now() + UsageResetMs) / 1000);
      const primary = { usedPercent: 10, windowDurationMins: 300, resetsAt };
      console.log(JSON.stringify({ id: 2, result: { rateLimits: { limitId: 'codex', primary } } }));
    }
  }
}

async function agy() {
  const versionFile = process.env.FAKE_AGY_VERSION_FILE;
  if (args[0] === '--version') {
    console.log(versionFile ? readFileSync(versionFile, 'utf8') : '1.5.14');
    return;
  }
  if (args[0] === 'update') {
    console.log('fake agy updating');
    if (versionFile) writeFileSync(versionFile, '1.5.15');
    return;
  }
  if (args[0] === '-p' && args[1] === '/usage') {
    const reset = new Date(Date.now() + UsageResetMs).toISOString();
    console.log(
      JSON.stringify({
        conversation_id: '',
        status: 'SUCCESS',
        command: {
          name: 'usage',
          data: {
            groups: [
              {
                name: 'Gemini Models',
                buckets: [{ id: 'gemini-5h', window: '5h', remaining_fraction: 0.77, reset_time: reset }],
              },
            ],
          },
        },
      })
    );
    return;
  }
  if (args[0] === 'acp' && args.includes('--stdio')) {
    const logIndex = args.indexOf('--log-file');
    const logFile = logIndex >= 0 ? args[logIndex + 1] : undefined;
    const isSignedIn = existsSync(`${home}/.gemini/antigravity-cli/signed-in`);
    const email = isSignedIn ? readFileSync(`${home}/.gemini/antigravity-cli/signed-in`, 'utf8').trim() : '';
    for await (const line of console) {
      let message: { id?: number; method?: string } | undefined;
      try {
        message = JSON.parse(line) as { id?: number; method?: string };
      } catch {
        continue;
      }
      if (message.method === 'initialize') {
        console.log(JSON.stringify({ jsonrpc: '2.0', id: message.id, result: {} }));
      }
      if (message.method === 'session/list') {
        if (!isSignedIn) {
          console.log(
            JSON.stringify({
              jsonrpc: '2.0',
              id: message.id,
              error: { code: -32000, message: 'Authentication required' },
            })
          );
        } else {
          if (logFile && email) {
            writeFileSync(logFile, `applyAuthResult: email=${email}, authMethod=consumer, quotaProject=\n`);
          }
          console.log(JSON.stringify({ jsonrpc: '2.0', id: message.id, result: { sessions: [] } }));
        }
      }
      if (message.method === 'authenticate') {
        console.log(
          JSON.stringify({
            jsonrpc: '2.0',
            id: message.id,
            result: { _meta: { antigravity: { tier: { name: 'Google AI Pro' } } } },
          })
        );
      }
    }
    return;
  }
  if (args[0] === 'models') {
    if (existsSync(`${home}/.gemini/antigravity-cli/signed-in`)) {
      console.log('gemini-4-neon-xhigh');
      return;
    }
    console.error('Error: Please sign in to view available models.');
    process.exit(1);
  }
  const gitconfig = existsSync(`${home}/.gitconfig`) ? readFileSync(`${home}/.gitconfig`, 'utf8') : '';
  console.log(`fake agy home=${home} gitconfig=${gitconfig}`);
}

function opencode() {
  const data = process.env.XDG_DATA_HOME ?? `${home}/.local/share`;
  if (args[0] === '--version') {
    console.log('opencode v2.2.5');
    return;
  }
  if (args[0] === 'upgrade') {
    console.log('fake opencode upgrading');
    return;
  }
  if (args[0] === '--help') {
    console.log('--standalone  Run with a private server');
    return;
  }
  if (args[0] === 'auth' && args[1] === 'list') {
    const hasLogin = existsSync(`${data}/opencode/auth.json`);
    console.log(hasLogin ? 'OpenAI  OAuth  stored' : 'No authenticated integrations');
    return;
  }
  console.log(`fake opencode data=${data} args=${args.join(' ')}`);
}

function ssh() {
  appendFileSync(process.env.FAKE_SSH_LOG!, `${args.join(' ')}\n`);
  const rest = [...args];
  while (rest[0] === '-T' || rest[0] === '-t' || rest[0] === '-o') rest.splice(0, rest[0] === '-o' ? 2 : 1);
  if (rest[0] === '--') rest.shift();
  const [target, ...command] = rest;
  if (target === 'down@host') {
    console.error('ssh: connect to host port 22: Connection refused');
    process.exit(255);
  }
  const { FAVO_HOME: _favoHome, ...env } = process.env;
  const result = spawnSync('bash', ['-c', command.join(' ')], {
    cwd: process.env.FAKE_REMOTE_HOME,
    env: { ...env, HOME: process.env.FAKE_REMOTE_HOME, FAVO_HOSTNAME: 'fake-remote' },
    stdio: 'inherit',
  });
  process.exit(result.status ?? 1);
}

function scp() {
  appendFileSync(process.env.FAKE_SSH_LOG!, `scp ${args.join(' ')}\n`);
  const [source, destination] = args.slice(-2);
  if (destination!.startsWith('down@host')) process.exit(1);
  copyFileSync(source!, `${process.env.FAKE_REMOTE_HOME}/${destination!.split(':').at(-1)}`);
}

function herdr() {
  const log = process.env.FAKE_HERDR_LOG!;
  const earlier = existsSync(log) ? readFileSync(log, 'utf8').split('\n').filter(Boolean).length : 0;
  appendFileSync(log, `${args.join(' ')}\n`);
  if (earlier < Number(process.env.FAKE_HERDR_REFUSALS ?? 0)) {
    console.error('error: resume_not_accepted');
    process.exit(1);
  }
}

const fakes: Record<string, () => unknown> = { claude, codex, agy, opencode, ssh, scp, herdr };
await fakes[name!]!();
if (isWindows) process.exitCode ??= 0;
