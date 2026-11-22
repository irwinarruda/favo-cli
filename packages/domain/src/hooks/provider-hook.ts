import { HookKind, type ProviderId, type ProviderSpec, Providers } from '#domain/providers/provider';
import { assertDomain, DomainErrorCode } from '#domain/shared/domain-error';
import { parseJson } from '#domain/shared/parse-json';
import type { ValueOf } from '#domain/shared/value-of';

export const HookVersion = 1;

const HookTimeoutSeconds = 5;
const NamedBlock = 'favo';
const MarkerPattern = /favo-hook:[a-z]+:(\d+)/;
const EncodedScript = /-EncodedCommand\s+(\S+)/;
const DefaultIndent = 2;

export const HookState = {
  absent: 'absent',
  current: 'current',
  outdated: 'outdated',
} as const;
export type HookState = ValueOf<typeof HookState>;

export const HookBlockReason = {
  disableAllHooks: 'disableAllHooks',
  disabledBlock: 'disabledBlock',
} as const;
export type HookBlockReason = ValueOf<typeof HookBlockReason>;

type JsonObject = Record<string, unknown>;

export function hookCommandOf(provider: ProviderId, isWindows: boolean) {
  const { executable, hook } = Providers[provider];
  const marker = `favo-hook:${provider}:${HookVersion}`;
  const hasStdoutAnswer = hook.kind === HookKind.namedBlock;
  if (isWindows) {
    const answer = hasStdoutAnswer ? " Write-Output '{}';" : '';
    const script = `$OutputEncoding = [Console]::InputEncoding; if ($env:FAVO_ACCOUNT) { $favo = if ($env:FAVO_BIN) { $env:FAVO_BIN } else { 'favo' }; try { $input | & $favo hook ${executable} 2>$null | Out-Null } catch {} };${answer} exit 0 # ${marker}`;
    return `powershell -NoProfile -NonInteractive -ExecutionPolicy Bypass -EncodedCommand ${encodeUtf16(script)}`;
  }
  const answer = hasStdoutAnswer ? '; echo {}' : '';
  const run = `"\${FAVO_BIN:-favo}" hook ${executable} "$PPID" >/dev/null 2>&1`;
  return `sh -c '[ -z "$FAVO_ACCOUNT" ] || ${run} || true${answer}' ${marker}`;
}

export function hookPathOf(spec: ProviderSpec, paths: { home: string; configHome: string }) {
  const base = spec.hook.kind === HookKind.plugin ? paths.configHome : paths.home;
  return `${base}/${spec.hook.file}`;
}

export function hookStateOf(spec: ProviderSpec, text: string | undefined): HookState {
  if (text === undefined) return HookState.absent;
  if (spec.hook.kind === HookKind.plugin) return stateOfVersion(versionIn(text));
  const versions = commandsOf(spec, parseConfig(spec, text)).map(versionIn);
  return stateOfVersion(versions.find((version) => version !== undefined));
}

export function hookBlockReasonOf(spec: ProviderSpec, text: string | undefined): HookBlockReason | undefined {
  if (text === undefined || spec.hook.kind === HookKind.plugin) return undefined;
  const config = parseConfig(spec, text);
  if (config.disableAllHooks === true) return HookBlockReason.disableAllHooks;
  if (spec.hook.kind !== HookKind.namedBlock) return undefined;
  const block = config[NamedBlock];
  return isObject(block) && block.enabled === false ? HookBlockReason.disabledBlock : undefined;
}

export function withHook(spec: ProviderSpec, text: string | undefined, isWindows: boolean) {
  const config = parseConfig(spec, text);
  const entry = { type: 'command', command: hookCommandOf(spec.id, isWindows), timeout: HookTimeoutSeconds };
  if (spec.hook.kind === HookKind.namedBlock) {
    const existing = isObject(config[NamedBlock]) ? config[NamedBlock] : {};
    config[NamedBlock] = { ...existing, [spec.hook.event!]: [entry] };
  } else placeInGroups(spec, config, entry);
  return serialized(config, text);
}

export function withoutHook(spec: ProviderSpec, text: string) {
  if (spec.hook.kind === HookKind.plugin) return undefined;
  const config = parseConfig(spec, text);
  if (spec.hook.kind === HookKind.namedBlock) delete config[NamedBlock];
  else removeFromGroups(spec, config);
  return serialized(config, text);
}

function placeInGroups(spec: ProviderSpec, config: JsonObject, entry: JsonObject) {
  const { event, matcher } = spec.hook;
  const groups = groupsOf(spec, config);
  const holders = groups.filter(holdsFavoHandler);
  for (const group of holders) {
    group.hooks = (group.hooks as unknown[]).map((handler) => (isFavoHandler(handler) ? entry : handler));
  }
  if (holders.length === 0) groups.push({ ...(matcher ? { matcher } : {}), hooks: [entry] });
  config.hooks = { ...(config.hooks as JsonObject | undefined), [event!]: groups };
}

function removeFromGroups(spec: ProviderSpec, config: JsonObject) {
  const event = spec.hook.event!;
  const groups = groupsOf(spec, config).flatMap((group) => {
    if (!holdsFavoHandler(group)) return [group];
    const others = (group.hooks as unknown[]).filter((handler) => !isFavoHandler(handler));
    return others.length > 0 ? [{ ...group, hooks: others }] : [];
  });
  if (config.hooks === undefined) return;
  const { [event]: _removed, ...otherEvents } = config.hooks as JsonObject;
  const hooks = groups.length > 0 ? { ...otherEvents, [event]: groups } : otherEvents;
  if (Object.keys(hooks).length > 0) config.hooks = hooks;
  else delete config.hooks;
}

function commandsOf(spec: ProviderSpec, config: JsonObject) {
  if (spec.hook.kind === HookKind.namedBlock) {
    const block = config[NamedBlock];
    const handlers = isObject(block) ? block[spec.hook.event!] : undefined;
    return Array.isArray(handlers) ? handlers.filter(isObject).map(commandOf) : [];
  }
  return groupsOf(spec, config).flatMap(handlersOf).map(commandOf);
}

function groupsOf(spec: ProviderSpec, config: JsonObject) {
  const hooks = config.hooks;
  if (hooks === undefined) return [];
  assertShape(spec, isObject(hooks));
  const groups = hooks[spec.hook.event!];
  if (groups === undefined) return [];
  assertShape(spec, Array.isArray(groups) && groups.every(isObject));
  return groups as JsonObject[];
}

function handlersOf(group: JsonObject) {
  return Array.isArray(group.hooks) ? group.hooks.filter(isObject) : [];
}

function commandOf(handler: JsonObject) {
  return typeof handler.command === 'string' ? handler.command : '';
}

function holdsFavoHandler(group: JsonObject) {
  return Array.isArray(group.hooks) && group.hooks.some(isFavoHandler);
}

function isFavoHandler(handler: unknown) {
  return isObject(handler) && versionIn(commandOf(handler)) !== undefined;
}

function versionIn(text: string) {
  const matched = MarkerPattern.exec(text) ?? MarkerPattern.exec(decodedScriptOf(text));
  return matched ? Number(matched[1]) : undefined;
}

function decodedScriptOf(command: string) {
  try {
    const encoded = EncodedScript.exec(command)?.[1] ?? '';
    const bytes = Uint8Array.from(atob(encoded), (character) => character.charCodeAt(0));
    return new TextDecoder('utf-16le').decode(bytes);
  } catch {
    return '';
  }
}

function stateOfVersion(version: number | undefined) {
  if (version === undefined) return HookState.absent;
  return version === HookVersion ? HookState.current : HookState.outdated;
}

function parseConfig(spec: ProviderSpec, text: string | undefined): JsonObject {
  if (text === undefined || text.trim() === '') return {};
  const parsed = parseJson(text);
  assertShape(spec, isObject(parsed));
  return parsed;
}

function assertShape(spec: ProviderSpec, condition: unknown): asserts condition {
  assertDomain(
    condition,
    DomainErrorCode.invalidConfig,
    `~/${spec.hook.file} is not the JSON favo expected, so favo left it alone.`
  );
}

function serialized(config: JsonObject, text: string | undefined) {
  const indent = /^[ \t]+(?=")/m.exec(text ?? '')?.[0] ?? DefaultIndent;
  return `${JSON.stringify(config, undefined, indent)}\n`;
}

function isObject(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function encodeUtf16(text: string) {
  const bytes = new Uint8Array(new Uint16Array(Array.from(text, (character) => character.charCodeAt(0))).buffer);
  return btoa(Array.from(bytes, (byte) => String.fromCharCode(byte)).join(''));
}
