export type Transform =
	| 'none'
	| 'string'
	| 'number'
	| 'integer'
	| 'boolean'
	| 'round'
	| 'trim'
	| 'uppercase'
	| 'lowercase'
	| 'date'
	| 'split'
	| 'join'
	| 'lookup';

export type IfMissing = 'skip' | 'null' | 'default' | 'error';
export type LookupFallback = 'keep' | 'default' | 'null' | 'error';

export interface MappingRule {
	/** Path in the input to read from. Ignored when `value` is set. */
	source?: string;
	/** Fixed value to write instead of reading from `source`. */
	value?: unknown;
	target: string;
	transform?: Transform;
	ifMissing?: IfMissing;
	default?: unknown;
	separator?: string;
	decimals?: number;
	dateInputFormat?: string;
	dateOutputFormat?: string;
	lookup?: Record<string, unknown> | string;
	lookupFallback?: LookupFallback;
	lookupDefault?: unknown;
}

export class MappingError extends Error {}

type Token = string | number | '*';
const WILDCARD = '*';

const pathCache = new Map<string, Token[]>();

/**
 * Parses `a.b[0].c[*]["key with spaces"]` into tokens.
 * An empty path or `.` refers to the whole input.
 */
export function parsePath(path: string): Token[] {
	const cached = pathCache.get(path);
	if (cached) return cached;

	const tokens: Token[] = [];
	const trimmed = path.trim();
	if (trimmed !== '' && trimmed !== '.') {
		let i = 0;
		let key = '';
		const pushKey = () => {
			if (key !== '') tokens.push(key);
			key = '';
		};
		while (i < trimmed.length) {
			const ch = trimmed[i];
			if (ch === '.') {
				pushKey();
				i++;
			} else if (ch === '[') {
				pushKey();
				const close = trimmed.indexOf(']', i);
				if (close === -1) throw new MappingError(`Missing "]" in path "${path}"`);
				const inner = trimmed.slice(i + 1, close).trim();
				if (inner === WILDCARD) tokens.push(WILDCARD);
				else if (/^\d+$/.test(inner)) tokens.push(Number(inner));
				else if (/^(["']).*\1$/.test(inner)) tokens.push(inner.slice(1, -1));
				else throw new MappingError(`Invalid index "[${inner}]" in path "${path}". Use [0], [*] or ["key"].`);
				i = close + 1;
			} else {
				key += ch;
				i++;
			}
		}
		pushKey();
	}

	pathCache.set(path, tokens);
	return tokens;
}

/** Position of the nth `[*]` (1-based); -1 for n = 0. */
function nthWildcardPosition(tokens: Token[], n: number): number {
	if (n === 0) return -1;
	let seen = 0;
	return tokens.findIndex((t) => t === WILDCARD && ++seen === n);
}

function countWildcards(tokens: Token[]): number {
	return tokens.filter((t) => t === WILDCARD).length;
}

interface Resolved {
	indices: number[];
	value: unknown;
}

/**
 * Reads every value a path points to. Each `[*]` fans out over an array and records the
 * element index. A single object where an array is expected counts as a one-element array,
 * which keeps XML input (where one child is not an array) mappable with the same paths.
 */
export function resolvePath(root: unknown, tokens: Token[]): Resolved[] {
	const results: Resolved[] = [];
	const walk = (current: unknown, depth: number, indices: number[]) => {
		if (depth === tokens.length) {
			results.push({ indices, value: current });
			return;
		}
		const token = tokens[depth];
		if (token === WILDCARD) {
			if (current === undefined || current === null) return;
			const list = Array.isArray(current) ? current : [current];
			list.forEach((entry, index) => walk(entry, depth + 1, [...indices, index]));
			return;
		}
		if (current === null || typeof current !== 'object') {
			walk(undefined, depth + 1, indices);
			return;
		}
		if (typeof token === 'number' && !Array.isArray(current)) {
			walk(token === 0 ? current : undefined, depth + 1, indices);
			return;
		}
		walk((current as Record<string | number, unknown>)[token], depth + 1, indices);
	};
	walk(root, 0, []);
	return results;
}

function isContainer(value: unknown): value is Record<string | number, unknown> {
	return value !== null && typeof value === 'object';
}

function setAt(root: Record<string, unknown>, tokens: Token[], indices: number[], value: unknown, target: string) {
	if (tokens.length === 0) {
		if (!isContainer(value) || Array.isArray(value)) {
			throw new MappingError(`Target "${target}" refers to the whole output, so the value must be an object`);
		}
		Object.assign(root, value);
		return;
	}
	let current: Record<string | number, unknown> = root;
	let wildcard = 0;
	tokens.forEach((token, depth) => {
		const key = token === WILDCARD ? indices[wildcard++] : token;
		if (depth === tokens.length - 1) {
			current[key] = value;
			return;
		}
		const next = tokens[depth + 1];
		const wantArray = typeof next === 'number' || next === WILDCARD;
		if (!isContainer(current[key])) current[key] = wantArray ? [] : {};
		current = current[key] as Record<string | number, unknown>;
	});
}

/** Writes one value to every element a target path with `[*]` points to (for fixed values). */
function broadcast(root: Record<string, unknown>, tokens: Token[], value: unknown, target: string) {
	const walk = (current: Record<string | number, unknown>, depth: number) => {
		const token = tokens[depth];
		const last = depth === tokens.length - 1;
		if (token === WILDCARD) {
			if (!Array.isArray(current)) return;
			current.forEach((entry, index) => {
				if (last) current[index] = value;
				else if (isContainer(entry)) walk(entry, depth + 1);
			});
			return;
		}
		if (last) {
			current[token] = value;
			return;
		}
		const next = tokens[depth + 1];
		if (!isContainer(current[token])) {
			if (next === WILDCARD) return; // nothing to broadcast over yet
			current[token] = typeof next === 'number' ? [] : {};
		}
		walk(current[token] as Record<string | number, unknown>, depth + 1);
	};
	if (tokens.length === 0) throw new MappingError(`Target "${target}" must not be empty`);
	walk(root, 0);
}

const isMissing = (value: unknown) => value === undefined;

export function applyMappings(
	input: unknown,
	rules: MappingRule[],
	output: Record<string, unknown> = {},
): Record<string, unknown> {
	rules.forEach((rule, ruleIndex) => {
		let failure: unknown;
		try {
			applyRule(input, rule, output);
		} catch (error) {
			failure = error;
		}
		if (failure instanceof MappingError) {
			const label = `Mapping ${ruleIndex + 1}${rule.target ? ` (→ ${rule.target})` : ''}`;
			throw new MappingError(`${label}: ${failure.message}`);
		}
		if (failure) throw failure;
	});
	return output;
}

function applyRule(input: unknown, rule: MappingRule, output: Record<string, unknown>) {
	if (typeof rule.target !== 'string') throw new MappingError('"target" is required');
	const targetTokens = parsePath(rule.target);
	const targetWildcards = countWildcards(targetTokens);

	if (rule.value !== undefined) {
		const value = finalize(rule.value, rule);
		if (value === SKIP) return;
		if (targetWildcards > 0) broadcast(output, targetTokens, value, rule.target);
		else setAt(output, targetTokens, [], value, rule.target);
		return;
	}

	const sourceTokens = parsePath(rule.source ?? '');
	const sourceWildcards = countWildcards(sourceTokens);
	if (targetWildcards > sourceWildcards) {
		throw new MappingError(
			`Target has ${targetWildcards} [*] but source "${rule.source ?? ''}" has ${sourceWildcards}. Each [*] in the target needs a matching [*] in the source.`,
		);
	}

	const resolved = resolvePath(input, sourceTokens);

	if (targetWildcards === sourceWildcards) {
		if (resolved.length === 0 && sourceWildcards === 0) resolved.push({ indices: [], value: undefined });
		for (const { indices, value } of resolved) {
			const final = finalize(value, rule);
			if (final !== SKIP) setAt(output, targetTokens, indices, final, rule.target);
		}
		return;
	}

	// Fewer [*] in the target: collect the extra levels into a list per target element.
	// Every parent element gets a list, even an empty one, so the output shape is predictable.
	const groups = new Map<string, { indices: number[]; values: unknown[] }>();
	const parentTokens = sourceTokens.slice(0, nthWildcardPosition(sourceTokens, targetWildcards) + 1);
	for (const { indices } of resolvePath(input, parentTokens)) {
		groups.set(indices.join(','), { indices, values: [] });
	}
	// Join turns the collected list into one string, so it runs on the list, not on each value.
	const perValueRule = rule.transform === 'join' ? { ...rule, transform: 'none' as const } : rule;
	for (const { indices, value } of resolved) {
		const keep = indices.slice(0, targetWildcards);
		const key = keep.join(',');
		if (!groups.has(key)) groups.set(key, { indices: keep, values: [] });
		const final = finalize(value, perValueRule);
		if (final !== SKIP) groups.get(key)!.values.push(final);
	}
	for (const { indices, values } of groups.values()) {
		const result = rule.transform === 'join' ? applyTransform(values, rule) : values;
		setAt(output, targetTokens, indices, result, rule.target);
	}
}

const SKIP = Symbol('skip');

function finalize(raw: unknown, rule: MappingRule): unknown {
	let value = raw;
	if (isMissing(value)) {
		switch (rule.ifMissing ?? 'skip') {
			case 'skip':
				return SKIP;
			case 'null':
				return null;
			case 'default':
				return rule.default;
			case 'error':
				throw new MappingError(`Source "${rule.source ?? ''}" was not found in the input`);
		}
	}
	value = applyTransform(value, rule);
	return value;
}

const TRUE_WORDS = new Set(['true', '1', 'yes', 'y', 'on']);
const FALSE_WORDS = new Set(['false', '0', 'no', 'n', 'off', '']);

export function applyTransform(value: unknown, rule: MappingRule): unknown {
	const transform = rule.transform ?? 'none';
	if (value === null && transform !== 'lookup' && transform !== 'string') return null;

	switch (transform) {
		case 'none':
			return value;
		case 'string':
			if (value === null) return '';
			return typeof value === 'object' ? JSON.stringify(value) : String(value);
		case 'number':
		case 'integer':
		case 'round': {
			const num = toNumber(value);
			if (transform === 'integer') return Math.trunc(num);
			if (transform === 'round') {
				const factor = 10 ** (rule.decimals ?? 0);
				return Math.round((num + Number.EPSILON) * factor) / factor;
			}
			return num;
		}
		case 'boolean': {
			if (typeof value === 'boolean') return value;
			const word = String(value).trim().toLowerCase();
			if (TRUE_WORDS.has(word)) return true;
			if (FALSE_WORDS.has(word)) return false;
			throw new MappingError(`Cannot convert "${String(value)}" to a boolean`);
		}
		case 'trim':
			return mapStrings(value, (s) => s.trim());
		case 'uppercase':
			return mapStrings(value, (s) => s.toUpperCase());
		case 'lowercase':
			return mapStrings(value, (s) => s.toLowerCase());
		case 'date':
			return formatDate(parseDate(value, rule.dateInputFormat), rule.dateOutputFormat);
		case 'split':
			if (Array.isArray(value)) return value;
			return String(value)
				.split(rule.separator ?? ',')
				.map((s) => s.trim())
				.filter((s) => s !== '');
		case 'join':
			return (Array.isArray(value) ? value : [value]).map((v) => String(v)).join(rule.separator ?? ',');
		case 'lookup':
			return lookup(value, rule);
		default:
			throw new MappingError(`Unknown transform "${String(transform)}"`);
	}
}

function toNumber(value: unknown): number {
	if (typeof value === 'number') return value;
	const text = String(value).trim();
	const num = text === '' ? NaN : Number(text);
	if (Number.isNaN(num)) throw new MappingError(`Cannot convert "${String(value)}" to a number`);
	return num;
}

function mapStrings(value: unknown, fn: (s: string) => string): unknown {
	if (Array.isArray(value)) return value.map((v) => (typeof v === 'string' ? fn(v) : v));
	return typeof value === 'string' ? fn(value) : value;
}

export function parseLookupTable(table: Record<string, unknown> | string | undefined): Record<string, unknown> {
	if (table === undefined || table === null) return {};
	if (typeof table === 'object') return table;
	const trimmed = table.trim();
	if (trimmed.startsWith('{')) {
		const parsed = tryParseJson(trimmed);
		if (parsed.error) throw new MappingError('Lookup table looks like JSON but could not be parsed');
		return parsed.value as Record<string, unknown>;
	}
	const result: Record<string, unknown> = {};
	for (const line of trimmed.split(/\r?\n/)) {
		if (line.trim() === '') continue;
		const eq = line.indexOf('=');
		if (eq === -1) throw new MappingError(`Lookup table line "${line}" must look like key=value`);
		result[line.slice(0, eq).trim()] = line.slice(eq + 1).trim();
	}
	return result;
}

function lookup(value: unknown, rule: MappingRule): unknown {
	const table = parseLookupTable(rule.lookup);
	const key = value === null || value === undefined ? '' : String(value);
	if (Object.prototype.hasOwnProperty.call(table, key)) return table[key];
	switch (rule.lookupFallback ?? 'keep') {
		case 'keep':
			return value;
		case 'default':
			return rule.lookupDefault;
		case 'null':
			return null;
		case 'error':
			throw new MappingError(`No lookup entry for "${key}"`);
	}
}

const DATE_TOKENS = /yyyy|SSS|MM|dd|HH|mm|ss/g;

export function parseDate(value: unknown, inputFormat?: string): Date {
	if (value instanceof Date) return value;
	if (typeof value === 'number') return new Date(value);

	const text = String(value).trim();
	if (inputFormat) {
		const fields: string[] = [];
		const pattern = inputFormat.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(DATE_TOKENS, (token) => {
			fields.push(token);
			return `(\\d{${token.length}})`;
		});
		const match = new RegExp(`^${pattern}$`).exec(text);
		if (!match) throw new MappingError(`Date "${text}" does not match format "${inputFormat}"`);
		const parts: Record<string, number> = { yyyy: 1970, MM: 1, dd: 1, HH: 0, mm: 0, ss: 0, SSS: 0 };
		fields.forEach((token, i) => (parts[token] = Number(match[i + 1])));
		return new Date(Date.UTC(parts.yyyy, parts.MM - 1, parts.dd, parts.HH, parts.mm, parts.ss, parts.SSS));
	}

	const date = /^\d+$/.test(text) ? new Date(Number(text)) : new Date(text);
	if (Number.isNaN(date.getTime())) {
		throw new MappingError(`Cannot read "${text}" as a date. Set an input date format such as yyyyMMdd.`);
	}
	return date;
}

export function formatDate(date: Date, outputFormat?: string): string {
	if (!outputFormat) return date.toISOString();
	const pad = (n: number, width = 2) => String(n).padStart(width, '0');
	const parts: Record<string, string> = {
		yyyy: String(date.getUTCFullYear()),
		MM: pad(date.getUTCMonth() + 1),
		dd: pad(date.getUTCDate()),
		HH: pad(date.getUTCHours()),
		mm: pad(date.getUTCMinutes()),
		ss: pad(date.getUTCSeconds()),
		SSS: pad(date.getUTCMilliseconds(), 3),
	};
	return outputFormat.replace(DATE_TOKENS, (token) => parts[token]);
}

const RULE_KEYS = new Set([
	'source',
	'value',
	'target',
	'transform',
	'ifMissing',
	'default',
	'separator',
	'decimals',
	'dateInputFormat',
	'dateOutputFormat',
	'lookup',
	'lookupFallback',
	'lookupDefault',
]);

/** Validates a mapping definition given as JSON: an array of rules or `{ "mappings": [...] }`. */
export function parseDefinition(definition: unknown): MappingRule[] {
	let parsed = definition;
	if (typeof parsed === 'string') {
		const result = tryParseJson(parsed);
		if (result.error) throw new MappingError(`Mapping definition is not valid JSON: ${result.error}`);
		parsed = result.value;
	}
	if (parsed && typeof parsed === 'object' && !Array.isArray(parsed) && 'mappings' in parsed) {
		parsed = (parsed as { mappings: unknown }).mappings;
	}
	if (!Array.isArray(parsed)) {
		throw new MappingError('Mapping definition must be an array of mappings or an object with a "mappings" array');
	}
	return parsed.map((rule, i) => {
		if (!rule || typeof rule !== 'object' || Array.isArray(rule)) {
			throw new MappingError(`Mapping ${i + 1} must be an object`);
		}
		const unknownKey = Object.keys(rule).find((k) => !RULE_KEYS.has(k));
		if (unknownKey) throw new MappingError(`Mapping ${i + 1} has an unknown property "${unknownKey}"`);
		if (typeof (rule as MappingRule).target !== 'string') {
			throw new MappingError(`Mapping ${i + 1} needs a "target" path`);
		}
		return rule as MappingRule;
	});
}

function tryParseJson(text: string): { value?: unknown; error?: string } {
	try {
		return { value: JSON.parse(text) };
	} catch (error) {
		return { error: (error as Error).message };
	}
}
