import type {
	IDataObject,
	IExecuteFunctions,
	ILoadOptionsFunctions,
	INodeExecutionData,
	INodeProperties,
	INodePropertyOptions,
	ResourceMapperField,
	ResourceMapperFields,
	ResourceMapperValue,
} from 'n8n-workflow';
import { NodeOperationError } from 'n8n-workflow';

import { toCsv, type CsvColumn } from './csv';
import { applyMappings, MappingError, parsePath, setOwn, type MappingRule, type Transform } from './mapping';
import {
	autoMap,
	flattenSource,
	parseProfile,
	ProfileError,
	sourceFields,
	type FieldType,
	type Profile,
	type ProfileField,
	type ProfileFormat,
} from './profile';
import { jsonToXml, parseXml, xmlToJson, XmlParseError } from './xml';

type TargetFormat = 'json' | 'xml' | 'csv';
type OutputAs = 'item' | 'file';

// --- Parameters --------------------------------------------------------------

export const visualProperties: INodeProperties[] = [
	{
		displayName:
			'Paste your target profile, then fill each target field: drag a field from the INPUT panel, pick one from the Source Profile dropdown, or write an expression. Or switch to "Map Automatically" to match them by name.',
		name: 'howTo',
		type: 'notice',
		default: '',
	},
	{
		displayName: 'Output Format',
		name: 'targetFormat',
		type: 'options',
		noDataExpression: true,
		options: [
			{ name: 'JSON', value: 'json', description: 'Output the mapped data as JSON' },
			{ name: 'XML', value: 'xml', description: 'Output the mapped data as an XML document' },
			{ name: 'CSV', value: 'csv', description: 'Output the mapped data as CSV rows' },
		],
		default: 'json',
	},
	{
		displayName: 'Source Data',
		name: 'sourceData',
		type: 'options',
		noDataExpression: true,
		options: [
			{
				name: 'Incoming Item',
				value: 'item',
				description: 'Map the fields of the incoming item; you can drag them from the Input panel',
			},
			{
				name: 'XML or JSON Text in a Field',
				value: 'field',
				description: 'Parse XML or JSON text held in a field first, e.g. a raw order in "data"',
			},
			{ name: 'XML or JSON File', value: 'binary', description: 'Parse an XML or JSON file first' },
		],
		default: 'item',
	},
	{
		displayName: 'Source Field',
		name: 'sourceDataField',
		type: 'string',
		default: 'data',
		required: true,
		displayOptions: { show: { sourceData: ['field'] } },
	},
	{
		displayName: 'Source File Field',
		name: 'sourceDataBinary',
		type: 'string',
		default: 'data',
		required: true,
		displayOptions: { show: { sourceData: ['binary'] } },
	},
	{
		displayName: 'Source Profile',
		name: 'sourceProfile',
		type: 'string',
		typeOptions: { rows: 4 },
		default: '',
		placeholder: 'Optional: paste the structure of the incoming data, e.g. a sample order',
		description:
			'Optional. Describes the incoming data. When set, every target field gets a dropdown of source fields to pick from (you can still switch a field to an expression).',
	},
	{
		displayName: 'Target Profile',
		name: 'targetProfile',
		type: 'string',
		typeOptions: { rows: 8 },
		default: '',
		required: true,
		placeholder:
			'Paste an XML/JSON/Flat File profile component, JSON Schema, sample JSON or XML, XSD, or a CSV header row',
		description: 'The structure to map into. Its fields appear below as the targets.',
	},
	{
		displayName: 'Target Fields',
		name: 'mapping',
		type: 'resourceMapper',
		noDataExpression: true,
		default: { mappingMode: 'defineBelow', value: null },
		required: true,
		typeOptions: {
			loadOptionsDependsOn: ['targetProfile', 'options.profileFormat', 'sourceProfile', 'options.sourceProfileFormat'],
			resourceMapper: {
				resourceMapperMethod: 'getProfileFields',
				mode: 'add',
				valuesLabel: 'Target Fields',
				fieldWords: { singular: 'target field', plural: 'target fields' },
				addAllFields: true,
				multiKeyMatch: false,
				supportAutoMap: true,
				noFieldsError: 'No target fields found. Paste a target profile above.',
			},
		},
	},
	{
		displayName: 'Output To',
		name: 'outputAs',
		type: 'options',
		noDataExpression: true,
		options: [
			{
				name: 'Item',
				value: 'item',
				description: 'JSON becomes the output item; XML and CSV go into a text field',
			},
			{ name: 'File', value: 'file', description: 'Output a binary file' },
		],
		default: 'item',
	},
	{
		displayName: 'Put Output in Field',
		name: 'outputField',
		type: 'string',
		default: '',
		placeholder: 'xml',
		description: 'Field for the XML or CSV text. Leave empty to use "xml" or "csv".',
		displayOptions: { show: { outputAs: ['item'], targetFormat: ['xml', 'csv'] } },
	},
	{
		displayName: 'Put Output File in Field',
		name: 'binaryField',
		type: 'string',
		default: 'data',
		required: true,
		displayOptions: { show: { outputAs: ['file'] } },
	},
	{
		displayName: 'File Name',
		name: 'fileName',
		type: 'string',
		default: '',
		placeholder: 'output.xml',
		description: 'Leave empty to name the file "output" with the matching extension',
		displayOptions: { show: { outputAs: ['file'] } },
	},
	{
		displayName: 'Options',
		name: 'options',
		type: 'collection',
		placeholder: 'Add option',
		default: {},
		options: [
			{
				displayName: 'Add Auto-Map Report',
				name: 'autoMapReport',
				type: 'boolean',
				default: false,
				description:
					'Whether to add an _autoMap field listing matched and unmatched fields (Map Automatically with JSON output)',
			},
			{
				displayName: 'Auto-Map Minimum Confidence',
				name: 'threshold',
				type: 'number',
				typeOptions: { minValue: 0, maxValue: 1, numberPrecision: 2 },
				default: 0.6,
				description: 'How close names must be for Map Automatically, from 0 (anything) to 1 (identical)',
			},
			{
				displayName: 'Convert Types From Profile',
				name: 'convertTypes',
				type: 'boolean',
				default: true,
				description:
					'Whether to turn values into numbers or booleans where the profile says so. Values that cannot be converted are kept as they are.',
			},
			{
				displayName: 'CSV Delimiter',
				name: 'csvDelimiter',
				type: 'string',
				default: ',',
			},
			{
				displayName: 'CSV Header Row',
				name: 'csvHeader',
				type: 'boolean',
				default: true,
				description: 'Whether to start the CSV with a row of column names',
			},
			{
				displayName: 'CSV Line Ending',
				name: 'csvLineEnding',
				type: 'options',
				options: [
					{ name: 'LF', value: 'lf' },
					{ name: 'CRLF', value: 'crlf' },
				],
				default: 'lf',
			},
			{
				displayName: 'Escape CSV Formulas',
				name: 'csvEscapeFormulas',
				type: 'boolean',
				default: false,
				description:
					"Whether to put ' in front of CSV values that start with =, +, -, @, a tab or a carriage return, so spreadsheet apps don't run them as formulas (CSV injection). Negative numbers then start with ' too.",
			},
			{
				displayName: 'Include XML Declaration',
				name: 'xmlDeclaration',
				type: 'boolean',
				default: true,
				description: 'Whether to start the XML with &lt;?xml version="1.0" encoding="UTF-8"?&gt;',
			},
			{
				displayName: 'Keep Empty Values',
				name: 'keepEmpty',
				type: 'boolean',
				default: false,
				description: 'Whether to write target fields whose value is empty, instead of leaving them out',
			},
			{
				displayName: 'One CSV for All Items',
				name: 'csvCombine',
				type: 'boolean',
				default: true,
				description: 'Whether to put every item into one CSV document, instead of one CSV per item',
			},
			{
				displayName: 'Profile Format',
				name: 'profileFormat',
				type: 'options',
				// eslint-disable-next-line n8n-nodes-base/node-param-options-type-unsorted-items
				options: [
					{ name: 'Detect Automatically', value: 'auto' },
					{ name: 'Profile Component (XML/JSON/Flat File)', value: 'component' },
					{ name: 'JSON Schema', value: 'jsonSchema' },
					{ name: 'Sample JSON', value: 'sampleJson' },
					{ name: 'Sample XML', value: 'sampleXml' },
					{ name: 'XSD', value: 'xsd' },
					{ name: 'CSV Header', value: 'csv' },
				],
				default: 'auto',
			},
			{
				displayName: 'Read Profile From Binary Field',
				name: 'profileBinaryField',
				type: 'string',
				default: '',
				placeholder: 'data',
				description:
					'Read the target profile from an uploaded file in this binary field instead of the Target Profile box. Works with Map Automatically; to drag and drop, paste the profile.',
			},
			{
				displayName: 'Root Element',
				name: 'rootElement',
				type: 'string',
				default: '',
				placeholder: 'order',
				description:
					'XML root element name. Leave empty to use the profile\'s root (sample XML profiles), the single top-level field, or "root".',
			},
			{
				displayName: 'Source Profile Format',
				name: 'sourceProfileFormat',
				type: 'options',
				// eslint-disable-next-line n8n-nodes-base/node-param-options-type-unsorted-items
				options: [
					{ name: 'Detect Automatically', value: 'auto' },
					{ name: 'Profile Component (XML/JSON/Flat File)', value: 'component' },
					{ name: 'JSON Schema', value: 'jsonSchema' },
					{ name: 'Sample JSON', value: 'sampleJson' },
					{ name: 'Sample XML', value: 'sampleXml' },
					{ name: 'XSD', value: 'xsd' },
					{ name: 'CSV Header', value: 'csv' },
				],
				default: 'auto',
			},
		],
	},
];

// --- Field ids and labels ----------------------------------------------------

const ID_ESCAPES: Record<string, string> = {
	'%': '%25',
	'/': '%2F',
	'*': '%2A',
	'#': '%23',
	'.': '%2E',
	'[': '%5B',
	']': '%5D',
};

const escapeSegment = (s: string) => s.replace(/[%/*#.[\]]/g, (c) => ID_ESCAPES[c]);
const unescapeSegment = (s: string) => s.replace(/%(25|2F|2A|23|2E|5B|5D)/gi, (m) => decodeURIComponent(m));

/**
 * Turns a mapping path into an id that is safe as an object key in the n8n mapping widget
 * (no dots or brackets), e.g. order.line[*].$.sku → order/line/(star)/$/sku.
 */
export function encodeFieldId(path: string): string {
	const tokens = parsePath(path);
	if (tokens.length === 0) return '.';
	return tokens.map((t) => (t === '*' ? '*' : typeof t === 'number' ? `#${t}` : escapeSegment(t))).join('/');
}

function formatKey(key: string, first: boolean): string {
	if (/^[^.[\]\s"']+$/.test(key)) return first ? key : `.${key}`;
	return key.includes('"') ? `['${key}']` : `["${key}"]`;
}

export function decodeFieldId(id: string): string {
	if (id === '.' || id === '') return '';
	let path = '';
	for (const segment of id.split('/')) {
		if (segment === '*') path += '[*]';
		else if (/^#\d+$/.test(segment)) path += `[${segment.slice(1)}]`;
		else path += formatKey(unescapeSegment(segment), path === '');
	}
	return path;
}

/** Tree-style label for a target field, e.g. "order › line[] › @sku (number) *". */
export function fieldDisplayName(field: ProfileField): string {
	const tokens = parsePath(field.path);
	const parts: string[] = [];
	for (let k = 0; k < tokens.length; k++) {
		const token = tokens[k];
		if (token === '*') {
			if (parts.length > 0) parts[parts.length - 1] += '[]';
			else parts.push('[]');
			continue;
		}
		const next = tokens[k + 1];
		if (token === '$' && typeof next === 'string' && next !== '*') {
			parts.push(`@${next}`);
			k++;
			continue;
		}
		parts.push(token === '_' ? '(text)' : String(token));
	}
	let label = parts.join(' › ') || '(whole document)';
	if (field.type !== 'string') label += ` (${field.type})`;
	if (field.required) label += ' *';
	return label;
}

// --- Drag-and-drop references ------------------------------------------------

const DRAG_REFERENCE =
	/^=\s*\{\{\s*\$json((?:\??\.[A-Za-z_$][\w$]*|\??\.?\[\s*(?:\d+|"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*')\s*\])*)\s*\}\}\s*$/;
const DRAG_SEGMENT = /\??\.([A-Za-z_$][\w$]*)|\??\.?\[\s*(\d+|"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*')\s*\]/g;

type DragToken = { kind: 'key'; key: string } | { kind: 'index'; index: number } | { kind: 'star' };

/**
 * Reads a dragged-in reference such as ={{ $json.Items[0].SKU }} as a source path. When the target
 * repeats, the innermost array indexes become [*], so dropping one line's field maps every line.
 * Returns undefined for anything that is not a plain field reference.
 */
export function parseDragReference(raw: unknown, targetStars: number): string | undefined {
	if (typeof raw !== 'string') return undefined;
	const match = DRAG_REFERENCE.exec(raw);
	if (!match) return undefined;

	const tokens: DragToken[] = [];
	for (const m of match[1].matchAll(DRAG_SEGMENT)) {
		if (m[1] !== undefined) tokens.push({ kind: 'key', key: m[1] });
		else if (/^\d+$/.test(m[2])) tokens.push({ kind: 'index', index: Number(m[2]) });
		else tokens.push({ kind: 'key', key: m[2].slice(1, -1).replace(/\\(.)/g, '$1') });
	}

	const indexPositions = tokens.flatMap((t, i) => (t.kind === 'index' ? [i] : []));
	if (indexPositions.length < targetStars) return undefined;
	for (const position of indexPositions.slice(indexPositions.length - targetStars)) {
		tokens[position] = { kind: 'star' };
	}

	let path = '';
	for (const token of tokens) {
		if (token.kind === 'key') path += formatKey(token.key, path === '');
		else if (token.kind === 'index') path += `[${token.index}]`;
		else path += '[*]';
	}
	return path;
}

// --- Target field list for the mapping widget ---------------------------------

export async function getProfileFields(this: ILoadOptionsFunctions): Promise<ResourceMapperFields> {
	let text = '';
	try {
		text = String(this.getCurrentNodeParameter('targetProfile') ?? '').trim();
	} catch {
		text = '';
	}
	if (text === '') return { fields: [], emptyFieldsNotice: 'Paste a target profile above to load its fields.' };
	if (text.startsWith('=') || text.includes('{{')) {
		return {
			fields: [],
			emptyFieldsNotice:
				'The target profile comes from an expression, so its fields cannot be listed here. Paste the profile instead, or use Map Automatically.',
		};
	}

	let format: ProfileFormat = 'auto';
	try {
		format = (this.getCurrentNodeParameter('options.profileFormat') as ProfileFormat) || 'auto';
	} catch {
		format = 'auto';
	}

	let profile: Profile;
	try {
		profile = parseProfile(text, format);
	} catch (error) {
		return { fields: [], emptyFieldsNotice: `Could not read the target profile: ${(error as Error).message}` };
	}

	const sourceOptions = loadSourceOptions(this);
	const fields: ResourceMapperField[] = profile.fields.map((field) => ({
		id: encodeFieldId(field.path),
		displayName: fieldDisplayName(field),
		required: false,
		defaultMatch: false,
		canBeUsedToMatch: false,
		display: true,
		...(sourceOptions ? { type: 'options' as const, options: sourceOptions } : {}),
	}));
	return { fields };
}

/** Value prefix for a source field picked from the Source Profile dropdown. */
export const SOURCE_PREFIX = 'src::';

function loadSourceOptions(ctx: ILoadOptionsFunctions): INodePropertyOptions[] | undefined {
	let text = '';
	let format: ProfileFormat = 'auto';
	try {
		text = String(ctx.getCurrentNodeParameter('sourceProfile') ?? '').trim();
		format = (ctx.getCurrentNodeParameter('options.sourceProfileFormat') as ProfileFormat) || 'auto';
	} catch {
		return undefined;
	}
	if (text === '' || text.startsWith('=') || text.includes('{{')) return undefined;
	let fields: ProfileField[];
	try {
		fields = sourceFields(parseProfile(text, format));
	} catch {
		return undefined;
	}
	if (fields.length === 0) return undefined;
	return [
		{ name: '(Not Mapped)', value: '' },
		...fields.map((field) => ({ name: fieldDisplayName(field), value: `${SOURCE_PREFIX}${field.path}` })),
	];
}

// --- Execution ----------------------------------------------------------------

const typeTransform = (type: FieldType | undefined): Transform =>
	type === 'number' ? 'number' : type === 'boolean' ? 'boolean' : 'none';

const isEmpty = (v: unknown) => v === undefined || v === null || v === '' || v === '=';

function starCount(path: string): number {
	return parsePath(path).filter((t) => t === '*').length;
}

function parseSourceText(ctx: IExecuteFunctions, text: string, itemIndex: number): unknown {
	const trimmed = text.replace(/^\uFEFF/, '').trim();
	if (trimmed.startsWith('<')) {
		return xmlToJson(parseXml(trimmed), {
			attributes: 'group',
			attributeKey: '$',
			textKey: '_',
			includeRoot: true,
			alwaysArray: false,
			trim: true,
		});
	}
	const parsed = tryJson(trimmed);
	if (parsed.ok) return parsed.value;
	throw new NodeOperationError(ctx.getNode(), 'The source text is neither valid JSON nor XML', {
		itemIndex,
		description: parsed.error,
	});
}

function tryJson(text: string): { ok: true; value: unknown } | { ok: false; error: string } {
	try {
		return { ok: true, value: JSON.parse(text) };
	} catch (error) {
		return { ok: false, error: (error as Error).message };
	}
}

async function readSource(
	ctx: IExecuteFunctions,
	item: INodeExecutionData,
	itemIndex: number,
	options: IDataObject,
): Promise<unknown> {
	const sourceData = ctx.getNodeParameter('sourceData', itemIndex, 'item') as 'item' | 'field' | 'binary';
	const binaryField = (
		sourceData === 'binary'
			? (ctx.getNodeParameter('sourceDataBinary', itemIndex, 'data') as string)
			: String(options.sourceBinaryField ?? '')
	).trim();
	if (binaryField) {
		ctx.helpers.assertBinaryData(itemIndex, binaryField);
		const text = (await ctx.helpers.getBinaryDataBuffer(itemIndex, binaryField)).toString('utf8');
		return parseSourceText(ctx, text, itemIndex);
	}
	const field = (
		sourceData === 'field'
			? (ctx.getNodeParameter('sourceDataField', itemIndex, 'data') as string)
			: String(options.sourceField ?? '')
	).trim();
	if (field) {
		const value = item.json[field];
		if (value === undefined) {
			throw new NodeOperationError(ctx.getNode(), `Source field "${field}" does not exist`, { itemIndex });
		}
		return typeof value === 'object' ? value : parseSourceText(ctx, String(value), itemIndex);
	}
	return item.json;
}

async function readProfile(
	ctx: IExecuteFunctions,
	itemIndex: number,
	options: IDataObject,
	cache: Map<string, Profile>,
): Promise<Profile | undefined> {
	const binaryField = String(options.profileBinaryField ?? '').trim();
	let text: string;
	if (binaryField) {
		ctx.helpers.assertBinaryData(itemIndex, binaryField);
		text = (await ctx.helpers.getBinaryDataBuffer(itemIndex, binaryField)).toString('utf8').trim();
	} else {
		text = String(ctx.getNodeParameter('targetProfile', itemIndex, '') ?? '').trim();
	}
	if (text === '') return undefined;
	const format = (options.profileFormat as ProfileFormat) || 'auto';
	const key = `${format}\u0000${text}`;
	if (!cache.has(key)) cache.set(key, parseProfile(text, format));
	return cache.get(key);
}

interface BuiltRules {
	rules: MappingRule[];
	report?: IDataObject;
}

export function buildDropRules(
	raw: Record<string, unknown>,
	resolved: Record<string, unknown>,
	profile: Profile | undefined,
	options: { convertTypes: boolean; keepEmpty: boolean },
): MappingRule[] {
	const fieldsById = new Map((profile?.fields ?? []).map((f) => [encodeFieldId(f.path), f]));
	const sourceRules: MappingRule[] = [];
	const spreadRules: MappingRule[] = [];
	const broadcastRules: MappingRule[] = [];
	const valueRules: MappingRule[] = [];

	const ids = [...new Set([...Object.keys(raw), ...Object.keys(resolved)])];
	for (const id of ids) {
		const target = decodeFieldId(id);
		const rawValue = raw[id];
		const value = resolved[id];
		if (isEmpty(rawValue) && isEmpty(value)) {
			if (options.keepEmpty) valueRules.push({ value: '', target });
			continue;
		}
		const transform = options.convertTypes ? typeTransform(fieldsById.get(id)?.type) : 'none';
		const stars = starCount(target);
		const picked =
			typeof rawValue === 'string' && rawValue.startsWith(SOURCE_PREFIX) ? rawValue.slice(SOURCE_PREFIX.length) : undefined;
		const source = picked === undefined ? parseDragReference(rawValue, stars) : undefined;
		const loose = picked ?? (source === undefined && stars > 0 ? parseDragReference(rawValue, 0) : undefined);
		if (source !== undefined) {
			sourceRules.push({ source, target, transform, lenient: true });
		} else if (loose !== undefined) {
			// a field without enough list levels for a repeating target: let the engine find the lists
			(starCount(loose) >= stars ? sourceRules : broadcastRules).push({
				source: loose,
				target,
				transform,
				lenient: true,
				broadcast: true,
			});
		} else if (stars > 0 && Array.isArray(value)) {
			spreadRules.push({ value, target, transform, lenient: true, spread: true });
		} else {
			valueRules.push({ value: value ?? '', target, transform, lenient: true });
		}
	}
	// Field references create array elements first; fixed values can then fill every element.
	return [...sourceRules, ...spreadRules, ...broadcastRules, ...valueRules];
}

function buildRules(
	ctx: IExecuteFunctions,
	itemIndex: number,
	source: unknown,
	profile: Profile | undefined,
	options: IDataObject,
): BuiltRules {
	const mapping = ctx.getNodeParameter('mapping', itemIndex, undefined, { skipValidation: true }) as
		| ResourceMapperValue
		| undefined;
	const convertTypes = options.convertTypes !== false;

	if (mapping?.mappingMode === 'autoMapInputData') {
		if (!profile) {
			throw new NodeOperationError(
				ctx.getNode(),
				'Map Automatically needs a target profile. Paste one into the Target Profile box.',
				{ itemIndex },
			);
		}
		const result = autoMap(flattenSource(source), profile, {
			threshold: typeof options.threshold === 'number' ? options.threshold : 0.6,
			strategy: 'fuzzy',
			caseSensitive: false,
			reuseSources: false,
			unmatched: options.keepEmpty ? 'null' : 'skip',
		});
		const rules = result.rules.map((rule) => ({
			...rule,
			transform: convertTypes && rule.transform !== 'date' ? rule.transform : ('none' as Transform),
			lenient: true,
		}));
		const built: BuiltRules = { rules };
		if (options.autoMapReport === true) {
			built.report = { matched: result.matched as unknown as IDataObject[], unmatched: result.unmatched };
		}
		return built;
	}

	const raw = (ctx.getNodeParameter('mapping.value', itemIndex, {}, { rawExpressions: true, skipValidation: true }) ??
		{}) as Record<string, unknown>;
	const resolved = (mapping?.value ?? {}) as Record<string, unknown>;
	return {
		rules: buildDropRules(raw, resolved, profile, { convertTypes, keepEmpty: options.keepEmpty === true }),
	};
}

interface OrderNode {
	children: Map<string | number, OrderNode>;
}

function profileOrder(profile: Profile): OrderNode {
	const root: OrderNode = { children: new Map() };
	for (const field of profile.fields) {
		let node = root;
		for (const token of parsePath(field.path)) {
			if (!node.children.has(token)) node.children.set(token, { children: new Map() });
			node = node.children.get(token)!;
		}
	}
	return root;
}

function reorder(value: unknown, node: OrderNode | undefined): unknown {
	if (Array.isArray(value)) {
		const element = node?.children.get('*');
		return value.map((entry) => reorder(entry, element));
	}
	if (value === null || typeof value !== 'object' || value instanceof Date) return value;
	const input = value as Record<string, unknown>;
	const output: Record<string, unknown> = {};
	for (const key of node?.children.keys() ?? []) {
		if (typeof key === 'string' && key !== '*' && Object.prototype.hasOwnProperty.call(input, key)) {
			setOwn(output, key, reorder(input[key], node!.children.get(key)));
		}
	}
	for (const key of Object.keys(input)) {
		if (!Object.prototype.hasOwnProperty.call(output, key)) setOwn(output, key, reorder(input[key], node?.children.get(key)));
	}
	return output;
}

/** Puts fields in the order the target profile lists them, as XML consumers and XSDs expect. */
export function orderByProfile(mapped: Record<string, unknown>, profile: Profile | undefined): Record<string, unknown> {
	if (!profile || profile.fields.length === 0) return mapped;
	return reorder(mapped, profileOrder(profile)) as Record<string, unknown>;
}

function csvColumns(profile: Profile | undefined, records: unknown[]): CsvColumn[] {
	if (profile && profile.fields.length > 0) {
		return profile.fields.map((field) => ({
			path: field.path,
			header: profile.kind === 'csv' ? field.name : field.path.replace(/\[\*\]/g, '').replace(/\$\./g, '@'),
		}));
	}
	const seen = new Set<string>();
	const columns: CsvColumn[] = [];
	for (const record of records) {
		for (const { path } of flattenSource(record)) {
			if (seen.has(path)) continue;
			seen.add(path);
			columns.push({ path, header: path.replace(/\[\*\]/g, '') });
		}
	}
	return columns;
}

function csvText(records: unknown[], profile: Profile | undefined, options: IDataObject): string {
	return toCsv(records, csvColumns(profile, records), {
		delimiter: String(options.csvDelimiter ?? ',') || ',',
		header: options.csvHeader !== false,
		lineEnding: options.csvLineEnding === 'crlf' ? '\r\n' : '\n',
		escapeFormulas: options.csvEscapeFormulas === true,
	});
}

const MIME: Record<TargetFormat, string> = { json: 'application/json', xml: 'application/xml', csv: 'text/csv' };

async function textOutput(
	ctx: IExecuteFunctions,
	format: TargetFormat,
	text: string,
	itemIndex: number,
): Promise<INodeExecutionData> {
	const outputAs = ctx.getNodeParameter('outputAs', itemIndex, 'item') as OutputAs;
	if (outputAs === 'file') {
		const field = ctx.getNodeParameter('binaryField', itemIndex, 'data') as string;
		const fileName = (ctx.getNodeParameter('fileName', itemIndex, '') as string) || `output.${format}`;
		const binary = await ctx.helpers.prepareBinaryData(Buffer.from(text, 'utf8'), fileName, MIME[format]);
		return { json: {}, binary: { [field]: binary } };
	}
	const field = (ctx.getNodeParameter('outputField', itemIndex, '') as string) || format;
	return { json: { [field]: text } };
}

async function writeOne(
	ctx: IExecuteFunctions,
	format: TargetFormat,
	mapped: Record<string, unknown>,
	itemIndex: number,
	profile: Profile | undefined,
	options: IDataObject,
	report: IDataObject | undefined,
): Promise<INodeExecutionData> {
	if (format === 'json') {
		const outputAs = ctx.getNodeParameter('outputAs', itemIndex, 'item') as OutputAs;
		if (outputAs === 'item') return { json: (report ? { ...mapped, _autoMap: report } : mapped) as IDataObject };
		return textOutput(ctx, 'json', JSON.stringify(mapped, null, 2), itemIndex);
	}
	if (format === 'xml') {
		const xml = jsonToXml(mapped, {
			rootName:
				String(options.rootElement ?? '').trim() || (profile?.kind === 'sampleXml' ? profile.rootName : undefined),
			declaration: options.xmlDeclaration !== false,
			attributeKey: '$',
			textKey: '_',
		});
		return textOutput(ctx, 'xml', xml, itemIndex);
	}
	return textOutput(ctx, 'csv', csvText([mapped], profile, options), itemIndex);
}

function toNodeError(ctx: IExecuteFunctions, error: Error, itemIndex: number): NodeOperationError {
	if (error instanceof NodeOperationError) return error;
	const known = error instanceof MappingError || error instanceof XmlParseError || error instanceof ProfileError;
	return new NodeOperationError(ctx.getNode(), error.message, {
		itemIndex,
		description: known ? undefined : 'Unexpected error while mapping this item',
	});
}

export async function executeVisual(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
	const items = this.getInputData();
	const format = this.getNodeParameter('targetFormat', 0, 'json') as TargetFormat;
	const firstOptions = this.getNodeParameter('options', 0, {}) as IDataObject;
	const combineCsv = format === 'csv' && firstOptions.csvCombine !== false;
	const cache = new Map<string, Profile>();
	const returnData: INodeExecutionData[] = [];
	const csvRecords: Array<{ mapped: Record<string, unknown>; index: number }> = [];
	let csvProfile: Profile | undefined;

	for (let i = 0; i < items.length; i++) {
		try {
			const options = this.getNodeParameter('options', i, {}) as IDataObject;
			const source = await readSource(this, items[i], i, options);
			const profile = await readProfile(this, i, options, cache);
			const { rules, report } = buildRules(this, i, source, profile, options);
			const mapped = orderByProfile(applyMappings(source, rules, {}), profile);
			if (combineCsv) {
				csvRecords.push({ mapped, index: i });
				csvProfile ??= profile;
				continue;
			}
			const output = await writeOne(this, format, mapped, i, profile, options, report);
			returnData.push({ ...output, pairedItem: { item: i } });
		} catch (error) {
			if (this.continueOnFail()) {
				returnData.push({ json: { error: (error as Error).message }, pairedItem: { item: i } });
				continue;
			}
			throw toNodeError(this, error as Error, i);
		}
	}

	if (combineCsv && csvRecords.length > 0) {
		const text = csvText(
			csvRecords.map((r) => r.mapped),
			csvProfile,
			firstOptions,
		);
		const output = await textOutput(this, 'csv', text, 0);
		returnData.push({ ...output, pairedItem: csvRecords.map((r) => ({ item: r.index })) });
	}

	return [returnData];
}
