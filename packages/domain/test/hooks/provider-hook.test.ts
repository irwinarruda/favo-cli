import { describe, expect, it } from 'bun:test';
import {
  HookBlockReason,
  HookState,
  HookVersion,
  hookBlockReasonOf,
  hookCommandOf,
  hookPathOf,
  hookStateOf,
  withHook,
  withoutHook,
} from '#domain/hooks/provider-hook';
import { ProviderId, Providers } from '#domain/providers/provider';

const claude = Providers.claude;
const codex = Providers.codex;
const antigravity = Providers.antigravity;
const opencode = Providers.opencode;

function decodedScript(command: string) {
  const encoded = /-EncodedCommand (\S+)/.exec(command)![1]!;
  const bytes = Uint8Array.from(atob(encoded), (character) => character.charCodeAt(0));
  return new TextDecoder('utf-16le').decode(bytes);
}

describe('the hook command', () => {
  it('asks a real sh, because Codex runs it in your own login shell', () => {
    const command = hookCommandOf(ProviderId.claude, false);
    expect(command.startsWith("sh -c '")).toBe(true);
    expect(command).toContain(`"\${FAVO_BIN:-favo}" hook claude "$PPID"`);
  });
  it('starts nothing outside favo', () => {
    expect(hookCommandOf(ProviderId.codex, false)).toContain('[ -z "$FAVO_ACCOUNT" ] ||');
  });
  it('stays quiet and succeeds whatever favo does', () => {
    expect(hookCommandOf(ProviderId.claude, false)).toContain('>/dev/null 2>&1 || true');
  });
  it('gives Antigravity the empty answer it expects, even with favo gone', () => {
    expect(hookCommandOf(ProviderId.antigravity, false)).toContain('|| true; echo {}');
    expect(decodedScript(hookCommandOf(ProviderId.antigravity, true))).toContain("Write-Output '{}'");
  });
  it('uses the executable name, which favo hook can find again', () => {
    expect(hookCommandOf(ProviderId.antigravity, false)).toContain(' hook agy ');
  });
  it('survives a missing favo on Windows too', () => {
    const script = decodedScript(hookCommandOf(ProviderId.claude, true));
    expect(script).toContain('if ($env:FAVO_ACCOUNT)');
    expect(script).toContain('try {');
    expect(script).toContain('exit 0');
  });
  it('passes what the provider sends through to favo on Windows', () => {
    expect(decodedScript(hookCommandOf(ProviderId.codex, true))).toContain('$input | & $favo hook codex');
  });
  it('leaves the bytes the provider sends alone on Windows, so an accent in a folder survives', () => {
    expect(decodedScript(hookCommandOf(ProviderId.claude, true)).startsWith('$OutputEncoding = ')).toBe(true);
  });
  it('quotes nothing on Windows, because cmd and Git Bash read quotes differently', () => {
    expect(hookCommandOf(ProviderId.claude, true)).not.toMatch(/["'$]/);
  });
});

describe('where a hook lives', () => {
  const paths = { home: '/home/bee', configHome: '/config' };

  it('is in the base config, which every seat links to', () => {
    expect(hookPathOf(claude, paths)).toBe('/home/bee/.claude/settings.json');
    expect(hookPathOf(codex, paths)).toBe('/home/bee/.codex/hooks.json');
    expect(hookPathOf(antigravity, paths)).toBe('/home/bee/.gemini/config/hooks.json');
  });
  it('follows XDG_CONFIG_HOME for OpenCode', () => {
    expect(hookPathOf(opencode, paths)).toBe('/config/opencode/plugins/favo-threads.js');
  });
});

describe('adding the hook', () => {
  it('creates the file when there is none', () => {
    const config = JSON.parse(withHook(claude, undefined, false));
    expect(config.hooks.SessionStart[0].matcher).toBe('^(startup|resume|clear|compact|fork)$');
    expect(config.hooks.SessionStart[0].hooks[0]).toMatchObject({ type: 'command', timeout: 5 });
  });
  it('treats an empty file as an empty config', () => {
    expect(hookStateOf(claude, withHook(claude, '  \n', false))).toBe(HookState.current);
  });
  it('keeps everything else the user wrote', () => {
    const text = JSON.stringify({
      model: 'opus',
      hooks: {
        Stop: [{ hooks: [{ type: 'command', command: 'notify' }] }],
        SessionStart: [{ matcher: '*', hooks: [{ type: 'command', command: 'herdr' }] }],
      },
    });
    const config = JSON.parse(withHook(claude, text, false));
    expect(config.model).toBe('opus');
    expect(config.hooks.Stop).toEqual([{ hooks: [{ type: 'command', command: 'notify' }] }]);
    expect(config.hooks.SessionStart[0]).toEqual({ matcher: '*', hooks: [{ type: 'command', command: 'herdr' }] });
  });
  it('goes after the existing hooks, because Codex trusts each hook by its position', () => {
    const text = JSON.stringify({ hooks: { SessionStart: [{ hooks: [{ type: 'command', command: 'herdr' }] }] } });
    const groups = JSON.parse(withHook(codex, text, false)).hooks.SessionStart;
    expect(groups).toHaveLength(2);
    expect(groups[0].hooks[0].command).toBe('herdr');
  });
  it('needs no matcher on Codex', () => {
    expect(JSON.parse(withHook(codex, undefined, false)).hooks.SessionStart[0]).not.toHaveProperty('matcher');
  });
  it('adds one hook however many times it runs', () => {
    const twice = withHook(claude, withHook(claude, '{}', false), false);
    expect(JSON.parse(twice).hooks.SessionStart).toHaveLength(1);
  });
  it('replaces an older hook where it stands', () => {
    const current = hookCommandOf(ProviderId.codex, false);
    const older = current.replace(`favo-hook:codex:${HookVersion}`, 'favo-hook:codex:0');
    const text = JSON.stringify({
      hooks: { SessionStart: [{ hooks: [{ type: 'command', command: older }] }, { hooks: [{ command: 'mine' }] }] },
    });
    const groups = JSON.parse(withHook(codex, text, false)).hooks.SessionStart;
    expect(groups[0].hooks[0].command).toBe(current);
    expect(groups[1].hooks[0].command).toBe('mine');
  });
  it('keeps the indentation of the file', () => {
    expect(withHook(claude, '{\n    "model": "opus"\n}\n', false)).toContain('\n    "model"');
    expect(withHook(claude, '{\n\t"model": "opus"\n}\n', false)).toContain('\n\t"model"');
  });
  it('writes a named block for Antigravity, leaving the others and preserving enabled false', () => {
    const text = JSON.stringify({
      mine: { PreInvocation: [{ type: 'command', command: 'x' }] },
      favo: { enabled: false, PreInvocation: [{ type: 'command', command: 'old favo-hook:antigravity:0' }] },
    });
    const config = JSON.parse(withHook(antigravity, text, false));
    expect(config.mine.PreInvocation[0].command).toBe('x');
    expect(config.favo.enabled).toBe(false);
    expect(config.favo.PreInvocation[0].timeout).toBe(5);
    expect(hookStateOf(antigravity, JSON.stringify(config))).toBe(HookState.current);
  });
  it('leaves an entry alone even when it is not the shape favo writes', () => {
    const groups = [
      { matcher: 'y', hooks: { type: 'command', command: 'mine' } },
      { hooks: ['a plain string'] },
      { matcher: 'no hooks here' },
    ];
    const text = JSON.stringify({ hooks: { SessionStart: groups } });
    const placed = JSON.parse(withHook(claude, text, false)).hooks.SessionStart;
    expect(placed.slice(0, 3)).toEqual(groups);
    expect(placed).toHaveLength(4);
  });
  it('keeps a plain string that shares a group with favo', () => {
    const favo = { type: 'command', command: hookCommandOf(ProviderId.claude, false) };
    const older = { ...favo, command: favo.command.replace(/:\d+$/, ':0') };
    const text = JSON.stringify({ hooks: { SessionStart: [{ hooks: ['a plain string', older] }] } });
    const [group] = JSON.parse(withHook(claude, text, false)).hooks.SessionStart;
    expect(group.hooks[0]).toBe('a plain string');
    expect(group.hooks[1].command).toBe(favo.command);
  });
  it('refuses a file it cannot read rather than overwrite it', () => {
    expect(() => withHook(claude, '{ // a comment\n}', false)).toThrow('left it alone');
    expect(() => withHook(claude, '[]', false)).toThrow('left it alone');
    expect(() => withHook(claude, '{"hooks":[]}', false)).toThrow('left it alone');
    expect(() => withHook(claude, '{"hooks":{"SessionStart":"x"}}', false)).toThrow('left it alone');
  });
});

describe('the state of a hook', () => {
  it('is absent with no file, or with only other hooks', () => {
    expect(hookStateOf(claude, undefined)).toBe(HookState.absent);
    expect(hookStateOf(claude, '{}')).toBe(HookState.absent);
    expect(hookStateOf(claude, '{"hooks":{"SessionStart":[{"hooks":[{"command":"herdr"}]}]}}')).toBe(HookState.absent);
  });
  it('is current after adding it', () => {
    expect(hookStateOf(codex, withHook(codex, '{}', false))).toBe(HookState.current);
  });
  it('is outdated when an older favo wrote it', () => {
    const text = withHook(codex, '{}', false).replace(`favo-hook:codex:${HookVersion}`, 'favo-hook:codex:0');
    expect(hookStateOf(codex, text)).toBe(HookState.outdated);
  });
  it('recognizes its own Windows entry, whose text is encoded', () => {
    expect(hookStateOf(claude, withHook(claude, '{}', true))).toBe(HookState.current);
  });
  it('reads the version of a plugin from its first line', () => {
    expect(hookStateOf(opencode, `// favo-hook:opencode:${HookVersion}\nexport default {};`)).toBe(HookState.current);
    expect(hookStateOf(opencode, '// favo-hook:opencode:0\n')).toBe(HookState.outdated);
    expect(hookStateOf(opencode, 'export default {};')).toBe(HookState.absent);
  });
});

describe('removing the hook', () => {
  it('leaves what was there before', () => {
    const text = JSON.stringify({ model: 'opus', hooks: { Stop: [{ hooks: [{ command: 'notify' }] }] } });
    expect(JSON.parse(withoutHook(claude, withHook(claude, text, false))!)).toEqual(JSON.parse(text));
  });
  it('keeps a user hook in the same event', () => {
    const text = JSON.stringify({ hooks: { SessionStart: [{ hooks: [{ command: 'herdr' }] }] } });
    expect(JSON.parse(withoutHook(codex, withHook(codex, text, false))!)).toEqual(JSON.parse(text));
  });
  it('keeps a user hook sharing a group with favo', () => {
    const favo = hookCommandOf(ProviderId.codex, false);
    const text = JSON.stringify({ hooks: { SessionStart: [{ hooks: [{ command: favo }, { command: 'mine' }] }] } });
    const groups = JSON.parse(withoutHook(codex, text)!).hooks.SessionStart;
    expect(groups).toEqual([{ hooks: [{ command: 'mine' }] }]);
  });
  it('keeps a plain string and an odd entry when it takes its own out', () => {
    const favo = hookCommandOf(ProviderId.claude, false);
    const odd = { matcher: 'y', hooks: { command: 'mine' } };
    const text = JSON.stringify({ hooks: { SessionStart: [{ hooks: ['a plain string', { command: favo }] }, odd] } });
    expect(JSON.parse(withoutHook(claude, text)!).hooks.SessionStart).toEqual([{ hooks: ['a plain string'] }, odd]);
  });
  it('removes a Windows entry too', () => {
    const removed = withoutHook(claude, withHook(claude, '{"model":"opus"}', true))!;
    expect(JSON.parse(removed)).toEqual({ model: 'opus' });
  });
  it('removes the Antigravity block and no other', () => {
    const text = JSON.stringify({ mine: { PreInvocation: [] } });
    expect(JSON.parse(withoutHook(antigravity, withHook(antigravity, text, false))!)).toEqual(JSON.parse(text));
  });
  it('asks for the whole file to go when it is a plugin', () => {
    expect(withoutHook(opencode, '// favo-hook:opencode:1\n')).toBeUndefined();
  });
});

describe('a provider told to run no hooks', () => {
  it('tells disableAllHooks apart from a disabled Antigravity block', () => {
    expect(hookBlockReasonOf(claude, '{"disableAllHooks":true}')).toBe(HookBlockReason.disableAllHooks);
    expect(hookBlockReasonOf(claude, '{"disableAllHooks":false}')).toBeUndefined();
    expect(hookBlockReasonOf(antigravity, '{"disableAllHooks":true}')).toBe(HookBlockReason.disableAllHooks);
    expect(hookBlockReasonOf(antigravity, '{"favo":{"enabled":false}}')).toBe(HookBlockReason.disabledBlock);
    expect(hookBlockReasonOf(antigravity, '{"favo":{"enabled":true}}')).toBeUndefined();
    expect(hookBlockReasonOf(claude, undefined)).toBeUndefined();
  });
});
