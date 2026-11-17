import { describe, expect, test } from 'bun:test';
import { handoffPromptOf } from '#domain/threads/handoff-prompt';

describe('handoff prompts', () => {
  test('points the next provider to the saved transcript and current workspace', () => {
    const prompt = handoffPromptOf({
      sourceProvider: 'claude',
      transcript: '/Users/bee/.claude/projects/hive/session.jsonl',
      directory: '/Users/bee/code/hive',
    });

    expect(prompt).toContain('/Users/bee/.claude/projects/hive/session.jsonl');
    expect(prompt).toContain('/Users/bee/code/hive');
    expect(prompt).toContain('latest user-requested task');
  });

  test('warns the next provider when no transcript was saved', () => {
    const prompt = handoffPromptOf({ sourceProvider: 'codex', directory: '/Users/bee/code/hive' });

    expect(prompt).toContain('No session transcript was saved');
    expect(prompt).not.toContain('undefined');
  });
});
