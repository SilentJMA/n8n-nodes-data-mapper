import * as workflow from 'n8n-workflow';

type SafeReplace = (pattern: string, input: string, flags: string, replacement: string) => string;

/** n8n 2.x runs user patterns in a guarded engine. Older versions fall back to a native RegExp. */
const safeReplace = (workflow as { safeRegex?: { replace?: SafeReplace } }).safeRegex?.replace;

export function replaceAll(pattern: string, input: string, replacement: string): string {
	if (safeReplace) return safeReplace(pattern, input, 'g', replacement);
	return input.replace(new RegExp(pattern, 'g'), replacement);
}
