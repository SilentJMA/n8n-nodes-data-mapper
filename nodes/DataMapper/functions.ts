import { replaceAll } from './regex';
import * as dec from './decimal';
import { functionSpec } from './function-catalog';
import type { FunctionPort, FunctionType, MapFunction, PortDataType } from './function-catalog';
import { convertJapanese } from './japanese';
import type { JapaneseScript } from './japanese';
import {
	applyMappings,
	formatDate,
	MappingError,
	parseDate,
	parsePath,
	resolvePath,
} from './mapping';
import type { MappingRule } from './mapping';

/** A map: field mappings plus the functions they run through. */
export interface MapDefinition {
	mappings: MappingRule[];
	functions: MapFunction[];
}

export interface ScriptRequest {
	language: 'javascript' | 'python';
	code: string;
	inputs: FunctionPort[];
	outputs: FunctionPort[];
	/** One entry per call: input name → value, already converted to the input's data type. */
	rows: Array<Record<string, unknown>>;
}

export interface DataTableLookupRequest {
	dataTable: string;
	match: Array<{ column: string; value: unknown }>;
	columns: string[];
}

export interface SqlLookupRequest {
	sql: string;
	params: unknown[];
	columns: string[];
}

/** What the host (the node) provides for functions that reach outside the map. */
export interface FunctionContext {
	runScript?(request: ScriptRequest): Promise<Array<Record<string, unknown>>>;
	lookupDataTable?(request: DataTableLookupRequest): Promise<Record<string, unknown> | undefined>;
	querySql?(request: SqlLookupRequest): Promise<Record<string, unknown> | undefined>;
	/** Next value of a persistent counter. */
	nextSequence?(keyName: string, batchSize: number): number;
	now?(): Date;
	/** Cache shared by all items of a run (cache option "map"). */
	runCache?: Map<string, unknown>;
}

type PortValues = Record<number, unknown>;

interface Wire {
	source?: string;
	value?: unknown;
}

interface Evaluated {
	fn: MapFunction;
	/** Number of [*] the records of this function have. */
	depth: number;
	rows: Array<{ indices: number[]; outputs: PortValues; group?: string }>;
	/** Counter without records: values are taken when they are written. */
	lazy?: boolean;
}

const AGGREGATES = new Set<FunctionType>(['sum', 'count']);
const COUNTERS = new Set<FunctionType>(['runningTotal', 'lineItemIncrement', 'sequentialValue']);
const NOT_IN_USER_DEFINED = new Set<FunctionType>([
	'sum',
	'count',
	'runningTotal',
	'lineItemIncrement',
	'sequentialValue',
	'userDefined',
]);

const isEmpty = (value: unknown) => value === undefined || value === null || value === '';
const text = (value: unknown) => (value === undefined || value === null ? '' : String(value));
const stars = (path: string) => (path.match(/\[\*\]/g) ?? []).length;

// ---------------------------------------------------------------------------------------------
// Definition

/** Reads a stored definition: a rule array (older format) or `{ mappings, functions }`. */
export function readMapDefinition(raw: unknown): MapDefinition {
	if (Array.isArray(raw)) return { mappings: raw as MappingRule[], functions: [] };
	if (raw && typeof raw === 'object') {
		const value = raw as { mappings?: unknown; functions?: unknown };
		return {
			mappings: Array.isArray(value.mappings) ? (value.mappings as MappingRule[]) : [],
			functions: Array.isArray(value.functions) ? (value.functions as MapFunction[]) : [],
		};
	}
	return { mappings: [], functions: [] };
}

/** Checks that every mapping refers to an existing function and port. */
export function validateMapDefinition(definition: MapDefinition): void {
	const byKey = new Map<number, MapFunction>();
	for (const fn of definition.functions) {
		if (!functionSpec(fn.type)) throw new MappingError(`Unknown function type "${fn.type}"`);
		if (byKey.has(fn.key)) throw new MappingError(`Two functions use the key ${fn.key}`);
		byKey.set(fn.key, fn);
	}
	definition.mappings.forEach((rule, i) => {
		const label = `Mapping ${i + 1}`;
		if (rule.fromFunction !== undefined && rule.toFunction !== undefined) {
			throw new MappingError(
				`${label} connects two functions. Every mapping needs a field on one side.`,
			);
		}
		if (rule.fromFunction !== undefined) {
			const fn = byKey.get(rule.fromFunction);
			if (!fn)
				throw new MappingError(
					`${label} reads from function ${rule.fromFunction}, which does not exist`,
				);
			if (!fn.outputs.some((p) => p.key === rule.fromKey)) {
				throw new MappingError(
					`${label} reads output ${rule.fromKey} that function "${fn.type}" does not have`,
				);
			}
		}
		if (rule.toFunction !== undefined) {
			const fn = byKey.get(rule.toFunction);
			if (!fn)
				throw new MappingError(
					`${label} writes to function ${rule.toFunction}, which does not exist`,
				);
			if (!fn.inputs.some((p) => p.key === rule.toKey)) {
				throw new MappingError(
					`${label} writes input ${rule.toKey} that function "${fn.type}" does not have`,
				);
			}
		}
	});
}

// ---------------------------------------------------------------------------------------------
// Entry point

/**
 * Maps one input record. Functions run first, over every record their mapped inputs point to.
 * Their results become ordinary rules, so `[*]` handling is the same as for field mappings.
 * Returns more than one output when a Sum or Count with several groups fills a non-repeating field.
 */
export async function applyDefinition(
	input: unknown,
	definition: MapDefinition,
	context: FunctionContext = {},
): Promise<Array<Record<string, unknown>>> {
	validateMapDefinition(definition);
	const fieldRules = definition.mappings.filter(
		(r) => r.fromFunction === undefined && r.toFunction === undefined,
	);
	const outputRules = definition.mappings.filter((r) => r.fromFunction !== undefined);
	if (outputRules.length === 0) return [applyMappings(input, fieldRules)];

	const documentCache = new Map<string, unknown>();
	const evaluated = new Map<number, Evaluated>();
	for (const fn of definition.functions) {
		if (!outputRules.some((r) => r.fromFunction === fn.key)) continue;
		evaluated.set(
			fn.key,
			await evaluateFunction(fn, input, definition.mappings, context, documentCache),
		);
	}

	// A Sum or Count into a field outside its records gives one output per group.
	const splitter = outputRules
		.map((rule) => ({ rule, result: evaluated.get(rule.fromFunction!)! }))
		.find(
			({ rule, result }) => AGGREGATES.has(result.fn.type) && stars(rule.target) < result.depth,
		);
	const groups = splitter ? distinctGroups(splitter.result) : [undefined];

	return groups.map((group) => {
		const sourceRules: MappingRule[] = [
			...fieldRules.filter((r) => r.value === undefined && !r.broadcast),
		];
		const laterRules: MappingRule[] = fieldRules.filter(
			(r) => r.value !== undefined || r.broadcast,
		);
		const fills: Array<{ rule: MappingRule; result: Evaluated }> = [];
		const dedupe: string[] = [];

		for (const rule of outputRules) {
			const result = evaluated.get(rule.fromFunction!)!;
			const targetDepth = stars(rule.target);
			if (result.depth === 0 && COUNTERS.has(result.fn.type) && targetDepth > 0) {
				fills.push({ rule, result });
				continue;
			}
			const built = outputRule(rule, result, targetDepth, group, context);
			if (!built) continue;
			if (built.spread) sourceRules.push(built);
			else laterRules.push(built);
			if (AGGREGATES.has(result.fn.type) && targetDepth > 0) dedupe.push(rule.target);
		}

		const output = applyMappings(input, [...sourceRules, ...laterRules]);
		for (const { rule, result } of fills) fillCounter(input, output, rule, result, context);
		for (const target of dedupe) dedupeRows(output, target);
		return output;
	});
}

// ---------------------------------------------------------------------------------------------
// Evaluation of one function over its records

async function evaluateFunction(
	fn: MapFunction,
	input: unknown,
	rules: MappingRule[],
	context: FunctionContext,
	documentCache: Map<string, unknown>,
): Promise<Evaluated> {
	const wires = new Map<number, Wire>();
	for (const rule of rules) {
		if (rule.toFunction !== fn.key || rule.toKey === undefined) continue;
		wires.set(
			rule.toKey,
			rule.value !== undefined ? { value: rule.value } : { source: rule.source ?? '' },
		);
	}

	// The input with the most [*] decides which records the function runs for.
	const resolved = new Map<
		number,
		{
			depth: number;
			byIndex: Map<string, unknown>;
			list: Array<{ indices: number[]; value: unknown }>;
		}
	>();
	let driver: number | undefined;
	for (const [key, wire] of wires) {
		if (wire.source === undefined) continue;
		const tokens = parsePath(wire.source);
		const list = resolvePath(input, tokens);
		const depth = stars(wire.source);
		resolved.set(key, {
			depth,
			list,
			byIndex: new Map(list.map((entry) => [entry.indices.join(','), entry.value])),
		});
		if (driver === undefined || depth > resolved.get(driver)!.depth) driver = key;
	}
	// Count runs over the records of its counted field, so missing fields are not counted.
	if (fn.type === 'count' && resolved.has(1)) driver = 1;
	const driverEntry = driver === undefined ? undefined : resolved.get(driver);
	const depth = driverEntry?.depth ?? 0;
	const records =
		driverEntry && depth > 0 ? driverEntry.list.map((e) => e.indices) : [[] as number[]];

	const present: boolean[] = [];
	const rows: PortValues[] = records.map((indices) => {
		const values: PortValues = {};
		for (const port of fn.inputs) {
			const wire = wires.get(port.key);
			let value: unknown;
			if (wire?.value !== undefined) value = wire.value;
			else if (wire?.source !== undefined) {
				const entry = resolved.get(port.key)!;
				value = entry.byIndex.get(indices.slice(0, entry.depth).join(','));
			}
			if (port.key === 1) present.push(value !== undefined);
			values[port.key] =
				isEmpty(value) && port.default !== undefined && port.default !== '' ? port.default : value;
		}
		return values;
	});

	// A counter without records numbers target elements later: do not use up a value here.
	if (depth === 0 && COUNTERS.has(fn.type)) {
		return { fn, depth, lazy: true, rows: [{ indices: [], outputs: {} }] };
	}
	const outputs = await evaluateRows(fn, rows, context, documentCache, present);
	return {
		fn,
		depth,
		rows: records.map((indices, i) => ({
			indices,
			outputs: outputs[i],
			group: AGGREGATES.has(fn.type) ? text(rows[i][2]) : undefined,
		})),
	};
}

/** Evaluates a function for a batch of records. Inputs and outputs are keyed by port key. */
async function evaluateRows(
	fn: MapFunction,
	rows: PortValues[],
	context: FunctionContext,
	documentCache: Map<string, unknown>,
	present: boolean[] = rows.map((row) => row[1] !== undefined),
): Promise<PortValues[]> {
	const config = fn.config ?? {};
	const out = (value: unknown): PortValues => ({ [fn.outputs[0]?.key ?? 2]: value });

	switch (fn.type) {
		case 'script':
			return await cached(
				fn,
				rows,
				context,
				documentCache,
				async (pending) => await runScript(fn, pending, context),
			);
		case 'dataTableLookup':
			return await cached(
				fn,
				rows,
				context,
				documentCache,
				async (pending) =>
					await Promise.all(pending.map(async (row) => await lookupDataTable(fn, row, context))),
			);
		case 'sqlLookup':
			return await cached(
				fn,
				rows,
				context,
				documentCache,
				async (pending) =>
					await Promise.all(pending.map(async (row) => await querySql(fn, row, context))),
			);
		case 'userDefined':
			return await runUserDefined(fn, rows, context, documentCache);
		case 'runningTotal': {
			let total = dec.parseDecimal(0);
			return rows.map((row) => {
				if (!isEmpty(row[1])) total = dec.add(total, decimal(row[1]));
				return out(dec.toResult(total));
			});
		}
		case 'sum': {
			const totals = new Map<string, ReturnType<typeof dec.parseDecimal>>();
			for (const row of rows) {
				const group = text(row[2]);
				const current = totals.get(group) ?? dec.parseDecimal(0);
				totals.set(group, isEmpty(row[1]) ? current : dec.add(current, decimal(row[1])));
			}
			return rows.map((row) => out(dec.toResult(totals.get(text(row[2]))!)));
		}
		case 'count': {
			const counts = new Map<string, number>();
			rows.forEach((row, i) => {
				const group = text(row[2]);
				counts.set(group, (counts.get(group) ?? 0) + (present[i] ? 1 : 0));
			});
			return rows.map((row) => out(counts.get(text(row[2]))));
		}
		case 'lineItemIncrement': {
			let counter = 0;
			let previous: string | undefined;
			return rows.map((row) => {
				const reset = text(row[2]);
				counter = previous !== undefined && reset !== previous ? 1 : counter + 1;
				previous = reset;
				return out(counter);
			});
		}
		case 'sequentialValue':
			return rows.map(() => out(nextSequence(fn, context)));
		default:
			return rows.map((row) => evaluateScalar(fn, row, config, context));
	}
}

function evaluateScalar(
	fn: MapFunction,
	row: PortValues,
	config: Record<string, unknown>,
	context: FunctionContext,
): PortValues {
	const result = fn.outputs[0]?.key ?? 2;
	const out = (value: unknown): PortValues => ({ [result]: value });
	const s = (key: number) => text(row[key]);

	switch (fn.type) {
		case 'dateFormat': {
			if (isEmpty(row[1])) return out(undefined);
			const date = parseDate(row[1], stripQuotes(s(2)) || undefined);
			return out(formatMasked(date, s(3)));
		}
		case 'currentDate': {
			const now = context.now?.() ?? new Date();
			return out(s(1) ? formatMasked(now, s(1)) : now.toISOString());
		}
		case 'japaneseConvert':
			return out(
				convertJapanese(
					s(1),
					(config.from as JapaneseScript) ?? 'hiragana',
					(config.to as JapaneseScript) ?? 'katakanaFull',
				),
			);
		case 'simpleLookup': {
			const tableRows = Array.isArray(config.rows)
				? (config.rows as Array<{ key?: unknown; value?: unknown }>)
				: [];
			const match = tableRows.find((r) => text(r.key) === s(1));
			return out(match?.value);
		}
		case 'mathAbs':
			return numeric(row, (v) => dec.absolute(v));
		case 'mathCeil':
			return numeric(row, (v) => dec.ceil(v));
		case 'mathFloor':
			return numeric(row, (v) => dec.floor(v));
		case 'mathAdd':
			return numeric(row, (v) => dec.add(v, operand(row[2], 0)));
		case 'mathSubtract':
			return numeric(row, (v) => dec.subtract(v, operand(row[2], 0)));
		case 'mathMultiply':
			return numeric(row, (v) => dec.multiply(v, operand(row[2], 1)));
		case 'mathDivide':
			return numeric(row, (v) => dec.divide(v, operand(row[2], 1)));
		case 'mathPrecision':
			return numeric(
				row,
				(v) => dec.setPrecision(v, wholeNumber(row[2], 'Number of Precision')),
				true,
			);
		case 'numberFormat': {
			if (isEmpty(row[1])) return out(undefined);
			if (s(3) === '') throw new MappingError('Number Format needs an output mask');
			return out(
				guard(() =>
					dec.formatWithMask(s(2) ? dec.parseWithMask(row[1], s(2)) : decimal(row[1]), s(3)),
				),
			);
		}
		case 'leftTrim':
		case 'rightTrim': {
			if (isEmpty(row[2])) return out('');
			const length = wholeNumber(row[2], 'Fix to Length');
			const value = s(1);
			if (length >= value.length) return out(value);
			return out(
				fn.type === 'leftTrim' ? value.slice(value.length - length) : value.slice(0, length),
			);
		}
		case 'whitespaceTrim':
			return out(s(1).trim());
		case 'stringAppend':
		case 'stringPrepend': {
			const value = s(1);
			if (isEmpty(row[2])) return out(value);
			const length = wholeNumber(row[2], 'Fix to Length');
			const append = fn.type === 'stringAppend';
			if (value.length >= length)
				return out(append ? value.slice(0, length) : value.slice(value.length - length));
			const fill = s(3);
			if (fill === '') return out(value);
			const padding = fill
				.repeat(Math.ceil((length - value.length) / fill.length))
				.slice(0, length - value.length);
			return out(append ? value + padding : padding + value);
		}
		case 'stringConcat': {
			const joined = fn.inputs.map((p) => text(row[p.key])).join(text(config.delimiter));
			const fixed = text(config.fixedLength).trim();
			return out(fixed === '' ? joined : joined.slice(0, wholeNumber(fixed, 'Fixed Length')));
		}
		case 'stringReplace':
		case 'stringRemove': {
			const value = s(1);
			if (s(2) === '') return out(value);
			const replacement = fn.type === 'stringReplace' ? s(3) : '';
			return out(guard(() => replaceAll(s(2), value, replacement)));
		}
		case 'toLower':
			return out(s(1).toLowerCase());
		case 'toUpper':
			return out(s(1).toUpperCase());
		case 'stringSplit': {
			const value = s(1);
			let pieces: string[] = [];
			if (value !== '') {
				if (config.mode === 'length') {
					const size = wholeNumber(config.splitLength, 'Split Length');
					if (size < 1) throw new MappingError('Split Length must be at least 1');
					for (let i = 0; i < value.length; i += size) pieces.push(value.slice(i, i + size));
				} else {
					pieces = value.split(text(config.delimiter) || ',');
				}
			}
			if (pieces.length > fn.outputs.length) {
				throw new MappingError(
					`Invalid split, expected to have at most ${fn.outputs.length} outputs but found ${pieces.length}`,
				);
			}
			const values: PortValues = {};
			fn.outputs.forEach((p, i) => (values[p.key] = pieces[i]));
			return values;
		}
		default:
			throw new MappingError(`Function "${fn.type}" cannot run here`);
	}
}

// ---------------------------------------------------------------------------------------------
// Numeric helpers

/** Turns decimal errors into mapping errors, so the node reports them like other mapping problems. */
function guard<T>(run: () => T): T {
	let failure: unknown;
	let result: T | undefined;
	try {
		result = run();
	} catch (error) {
		failure = error;
	}
	if (failure instanceof dec.DecimalError) throw new MappingError(failure.message);
	if (failure !== undefined) throw failure;
	return result as T;
}

const decimal = (value: unknown) => guard(() => dec.parseDecimal(value));

const operand = (value: unknown, identity: number) =>
	isEmpty(value) ? dec.parseDecimal(identity) : decimal(value);

function numeric(
	row: PortValues,
	compute: (value: ReturnType<typeof dec.parseDecimal>) => ReturnType<typeof dec.parseDecimal>,
	keepText = false,
): PortValues {
	if (isEmpty(row[1])) return { 2: undefined };
	const result = guard(() => compute(decimal(row[1])));
	return { 2: keepText ? dec.toText(result) : dec.toResult(result) };
}

function wholeNumber(value: unknown, label: string): number {
	const num = Number(text(value).trim());
	if (text(value).trim() === '' || !Number.isInteger(num)) {
		throw new MappingError(`${label} must be a whole number, got "${text(value)}"`);
	}
	return num;
}

function nextSequence(fn: MapFunction, context: FunctionContext): string {
	if (!context.nextSequence) throw new MappingError('Sequential Value is not available here');
	const config = fn.config ?? {};
	const value = String(
		context.nextSequence(text(config.keyName) || 'counter', Number(config.batchSize) || 1),
	);
	const length = Number(config.fixedLength) || 0;
	return length > 0 ? value.padStart(length, '0').slice(-length) : value;
}

// ---------------------------------------------------------------------------------------------
// Date masks: letters inside single quotes are literal text, as in yyyy-MM-dd'T'HH:mm

function stripQuotes(mask: string): string {
	return mask.replace(/'([^']*)'/g, '$1');
}

function formatMasked(date: Date, mask: string): string {
	return mask
		.split(/('[^']*')/)
		.map((part) =>
			part.startsWith("'") && part.endsWith("'") && part.length >= 2
				? part.slice(1, -1)
				: part === ''
					? ''
					: formatDate(date, part),
		)
		.join('');
}

// ---------------------------------------------------------------------------------------------
// Functions that reach outside the map

function cacheKey(fn: MapFunction, row: PortValues): string {
	return `${fn.key}:${JSON.stringify(fn.inputs.map((p) => row[p.key] ?? null))}`;
}

/** Runs `compute` only for records whose inputs are not in the chosen cache yet. */
async function cached(
	fn: MapFunction,
	rows: PortValues[],
	context: FunctionContext,
	documentCache: Map<string, unknown>,
	compute: (rows: PortValues[]) => Promise<PortValues[]>,
): Promise<PortValues[]> {
	const store =
		fn.cache === 'map' ? context.runCache : fn.cache === 'document' ? documentCache : undefined;
	if (!store) return await compute(rows);
	const pending = rows.filter((row) => !store.has(cacheKey(fn, row)));
	const unique = [...new Map(pending.map((row) => [cacheKey(fn, row), row])).values()];
	const results = unique.length ? await compute(unique) : [];
	unique.forEach((row, i) => store.set(cacheKey(fn, row), results[i]));
	return rows.map((row) => store.get(cacheKey(fn, row)) as PortValues);
}

/** Converts a value to the data type of a script or SQL parameter. */
export function coerce(value: unknown, dataType: PortDataType | undefined): unknown {
	switch (dataType ?? 'character') {
		case 'character':
			return text(value);
		case 'integer': {
			if (isEmpty(value)) return null;
			const num = Number(text(value).trim());
			if (Number.isNaN(num)) throw new MappingError(`"${text(value)}" is not an integer`);
			return Math.trunc(num);
		}
		case 'float': {
			if (isEmpty(value)) return null;
			const num = Number(text(value).trim());
			if (Number.isNaN(num)) throw new MappingError(`"${text(value)}" is not a number`);
			return num;
		}
		case 'datetime':
			return isEmpty(value) ? null : parseDate(value).toISOString();
	}
}

const IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]*$/;

async function runScript(
	fn: MapFunction,
	rows: PortValues[],
	context: FunctionContext,
): Promise<PortValues[]> {
	if (!context.runScript)
		throw new MappingError('Scripting is available in the n8n core Data Mapper only');
	for (const p of [...fn.inputs, ...fn.outputs]) {
		if (!IDENTIFIER.test(p.name)) {
			throw new MappingError(`Script variable "${p.name}" must be a name of letters, digits and _`);
		}
	}
	const config = fn.config ?? {};
	const results = await context.runScript({
		language: config.language === 'python' ? 'python' : 'javascript',
		code: text(config.code),
		inputs: fn.inputs,
		outputs: fn.outputs,
		rows: rows.map((row) =>
			Object.fromEntries(fn.inputs.map((p) => [p.name, coerce(row[p.key], p.dataType)])),
		),
	});
	return rows.map((_, i) => {
		const values: PortValues = {};
		for (const p of fn.outputs) values[p.key] = results[i]?.[p.name];
		return values;
	});
}

async function lookupDataTable(
	fn: MapFunction,
	row: PortValues,
	context: FunctionContext,
): Promise<PortValues> {
	if (!context.lookupDataTable)
		throw new MappingError('Data Table Lookup is available in the n8n core Data Mapper only');
	const config = fn.config ?? {};
	const inputColumns = (config.inputColumns ?? {}) as Record<string, string>;
	const outputColumns = (config.outputColumns ?? {}) as Record<string, string>;
	const match = fn.inputs.map((p) => ({
		column: inputColumns[p.key] || p.name,
		value: row[p.key],
	}));
	// An empty key would match the first row: skip the lookup instead.
	if (match.every((m) => isEmpty(m.value))) return {};
	const columns = fn.outputs.map((p) => outputColumns[p.key] || p.name);
	const found = await context.lookupDataTable({
		dataTable: text(config.dataTable),
		match,
		columns,
	});
	const values: PortValues = {};
	fn.outputs.forEach((p, i) => (values[p.key] = found?.[columns[i]]));
	return values;
}

async function querySql(
	fn: MapFunction,
	row: PortValues,
	context: FunctionContext,
): Promise<PortValues> {
	if (!context.querySql)
		throw new MappingError('SQL Lookup is available in the n8n core Data Mapper only');
	const config = fn.config ?? {};
	const columns = fn.outputs.map((p) => p.name);
	const found = await context.querySql({
		sql: text(config.sql),
		params: fn.inputs.map((p) => coerce(row[p.key], p.dataType)),
		columns,
	});
	const values: PortValues = {};
	for (const p of fn.outputs) {
		const value = found?.[p.name];
		values[p.key] = value === null || value === undefined ? undefined : coerce(value, p.dataType);
	}
	return values;
}

// ---------------------------------------------------------------------------------------------
// User-Defined functions

export interface UserDefinedLink {
	/** `in:<input key>` or `step:<step key>:<output key>` */
	from: string;
	/** `step:<step key>:<input key>` or `out:<output key>` */
	to: string;
}

async function runUserDefined(
	fn: MapFunction,
	rows: PortValues[],
	context: FunctionContext,
	documentCache: Map<string, unknown>,
): Promise<PortValues[]> {
	const config = fn.config ?? {};
	const steps = (Array.isArray(config.steps) ? config.steps : []) as MapFunction[];
	const links = (Array.isArray(config.links) ? config.links : []) as UserDefinedLink[];
	// Values of every port, per record: `in:1`, `step:2:3`, …
	const values = rows.map((row) => {
		const map = new Map<string, unknown>();
		for (const p of fn.inputs) map.set(`in:${p.key}`, row[p.key]);
		return map;
	});
	for (const step of steps) {
		if (NOT_IN_USER_DEFINED.has(step.type)) {
			throw new MappingError(`"${step.type}" cannot be a step of a User-Defined function`);
		}
		const stepRows = values.map((map) => {
			const stepValues: PortValues = {};
			for (const p of step.inputs) {
				const link = links.find((l) => l.to === `step:${step.key}:${p.key}`);
				const value = link ? map.get(link.from) : undefined;
				stepValues[p.key] = isEmpty(value) && p.default ? p.default : value;
			}
			return stepValues;
		});
		const results = await evaluateRows(step, stepRows, context, documentCache);
		results.forEach((result, i) => {
			for (const p of step.outputs) values[i].set(`step:${step.key}:${p.key}`, result[p.key]);
		});
	}
	return values.map((map) => {
		const result: PortValues = {};
		for (const p of fn.outputs) {
			const link = links.find((l) => l.to === `out:${p.key}`);
			result[p.key] = link ? map.get(link.from) : undefined;
		}
		return result;
	});
}

// ---------------------------------------------------------------------------------------------
// Turning results into rules

function distinctGroups(result: Evaluated): Array<string | undefined> {
	return [...new Set(result.rows.map((r) => r.group ?? ''))];
}

/** Nested arrays indexed like the records, `depth` levels deep. Deeper records collect into lists. */
function nest(
	entries: Array<{ indices: number[]; value: unknown }>,
	depth: number,
	collect: boolean,
): unknown[] {
	const root: unknown[] = [];
	for (const { indices, value } of entries) {
		let current = root;
		for (let level = 0; level < depth - 1; level++) {
			const index = indices[level];
			if (!Array.isArray(current[index])) current[index] = [];
			current = current[index] as unknown[];
		}
		const last = indices[depth - 1];
		if (collect) {
			if (!Array.isArray(current[last])) current[last] = [];
			if (!isEmpty(value)) (current[last] as unknown[]).push(value);
		} else if (!isEmpty(value)) current[last] = value;
	}
	return root;
}

function outputRule(
	rule: MappingRule,
	result: Evaluated,
	targetDepth: number,
	group: string | undefined,
	context: FunctionContext,
): MappingRule | undefined {
	const key = rule.fromKey!;
	if (result.lazy) {
		const value =
			result.fn.type === 'sequentialValue'
				? nextSequence(result.fn, context)
				: result.fn.type === 'lineItemIncrement'
					? 1
					: undefined;
		return isEmpty(value) ? undefined : { target: rule.target, value };
	}
	const target = rule.target;
	const aggregate = AGGREGATES.has(result.fn.type);
	let rows = result.rows;
	if (aggregate && group !== undefined && targetDepth < result.depth) {
		rows = rows.filter((r) => (r.group ?? '') === group);
	}

	if (targetDepth > result.depth && result.depth > 0) {
		throw new MappingError(
			`Target "${target}" has ${targetDepth} [*] but function ${result.fn.key} runs over ${result.depth}`,
		);
	}
	if (result.depth === 0 || targetDepth === 0) {
		const value = aggregate
			? rows[0]?.outputs[key]
			: rows.length === 1
				? rows[0].outputs[key]
				: rows.map((r) => r.outputs[key]).filter((v) => !isEmpty(v));
		if (isEmpty(value)) return undefined;
		return { target, value };
	}
	const entries = rows.map((r) => ({ indices: r.indices, value: r.outputs[key] }));
	if (aggregate && targetDepth < result.depth) {
		// One total per target element: the records of an element share it.
		const trimmed = entries.map((e) => ({
			indices: e.indices.slice(0, targetDepth),
			value: e.value,
		}));
		return { target, value: nest(trimmed, targetDepth, false), spread: true };
	}
	return {
		target,
		value: nest(entries, targetDepth, targetDepth < result.depth),
		spread: true,
	};
}

/** Counters without mapped inputs number the target elements that the other mappings created. */
function fillCounter(
	input: unknown,
	output: Record<string, unknown>,
	rule: MappingRule,
	result: Evaluated,
	context: FunctionContext,
) {
	const tokens = parsePath(rule.target);
	const lastStar = tokens.lastIndexOf('*');
	const elements = resolvePath(output, tokens.slice(0, lastStar + 1)).filter(
		(e) => e.value !== undefined,
	);
	if (elements.length === 0) return;
	let counter = 0;
	const entries = elements.map(({ indices }) => {
		let value: unknown;
		if (result.fn.type === 'sequentialValue') value = nextSequence(result.fn, context);
		else if (result.fn.type === 'lineItemIncrement') value = ++counter;
		return { indices, value };
	});
	applyMappings(
		input,
		[{ target: rule.target, value: nest(entries, stars(rule.target), false), spread: true }],
		output,
	);
}

/** Removes identical elements from the list a Sum or Count writes into. */
function dedupeRows(output: Record<string, unknown>, target: string) {
	const tokens = parsePath(target);
	const lastStar = tokens.lastIndexOf('*');
	for (const { value } of resolvePath(output, tokens.slice(0, lastStar))) {
		if (!Array.isArray(value)) continue;
		const seen = new Set<string>();
		for (let i = 0; i < value.length; i++) {
			const signature = JSON.stringify(value[i]);
			if (seen.has(signature)) value.splice(i--, 1);
			else seen.add(signature);
		}
	}
}
