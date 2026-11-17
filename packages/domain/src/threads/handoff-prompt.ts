import { type ProviderId, Providers } from '#domain/providers/provider';

export function handoffPromptOf(input: { sourceProvider: ProviderId; transcript?: string; directory: string }) {
  const transcriptInstruction = input.transcript
    ? `Read the previous conversation from the local transcript at "${input.transcript}".`
    : 'No session transcript was saved for the previous session. Use the current workspace and its git state as context.';

  return [
    `Continue work after ${Providers[input.sourceProvider].label} reached its usage limit.`,
    `The working directory is "${input.directory}".`,
    transcriptInstruction,
    'Read the transcript as context for the latest user-requested task, then inspect the current workspace and git diff before acting. Continue unfinished work without repeating completed work. Ask only if critical information is missing.',
  ].join('\n\n');
}
