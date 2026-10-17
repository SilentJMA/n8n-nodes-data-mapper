import type {
	IDataObject,
	IExecuteFunctions,
	ILoadOptionsFunctions,
	INodeExecutionData,
	INodeProperties,
	INodePropertyOptions,
	INodeType,
	INodeTypeDescription,
} from 'n8n-workflow';
import { NodeConnectionTypes, NodeOperationError } from 'n8n-workflow';

import {
	applyMappings,
	MappingError,
	parseDefinition,
	type IfMissing,
	type LookupFallback,
	type MappingRule,
	type Transform,
} from './mapping';
import {
	autoMap,
	flattenSource,
	parseProfile,
	ProfileError,
	type AutoMapOptions,
	type Profile,
	type ProfileFormat,
} from './profile';
import { jsonToXml, parseXml, xmlToJson, XmlParseError } from './xml';

type InputSource = 'json' | 'field' | 'binary';
type InputFormat = 'auto' | 'json' | 'xml';
type OutputFormat = 'json' | 'xml' | 'xmlFile' | 'jsonFile';
type DefinitionMode = 'fields' | 'json' | 'auto';

interface UiMapping {
	sourceType: 'field' | 'value';
	source?: string;
	value?: unknown;
	targetMode?: 'profile' | 'custom';
	targetField?: string;
	target: string;
	transform: Transform;
	separator?: string;
	decimals?: number;
	dateInputFormat?: string;
	dateOutputFormat?: string;
	lookupTable?: string;
	lookupFallback?: LookupFallback;
	lookupDefault?: string;
	ifMissing: IfMissing;
	defaultValue?: string;
}

const show = (values: Record<string, string[]>) => ({ show: values });

const mappingFields: INodeProperties[] = [
	{
		displayName: 'Source',
		name: 'sourceType',
		type: 'options',
		options: [
			{ name: 'Input Field', value: 'field', description: 'Read a value from the input by path' },
			{ name: 'Fixed Value', value: 'value', description: 'Write a fixed value or the result of an expression' },
		],
		default: 'field',
	},
	{
		displayName: 'Source Path',
		name: 'source',
		type: 'string',
		default: '',
		placeholder: 'customer.addresses[*].city',
		description:
			'Dot path into the input. Use [0] for one array element, [*] for every element, or leave empty for the whole input.',
		displayOptions: show({ sourceType: ['field'] }),
	},
	{
		displayName: 'Value',
		name: 'value',
		type: 'string',
		default: '',
		description: 'Fixed text, or an expression such as {{ $now.toISO() }}',
		displayOptions: show({ sourceType: ['value'] }),
	},
	{
		displayName: 'Target',
		name: 'targetMode',
		type: 'options',
		options: [
			{ name: 'Custom Path', value: 'custom', description: 'Type the target path yourself' },
			{
				name: 'From Target Profile',
				value: 'profile',
				description: 'Pick a field from the uploaded target profile',
			},
		],
		default: 'custom',
	},
	{
		displayName: 'Target Field Name or ID',
		name: 'targetField',
		type: 'options',
		typeOptions: { loadOptionsMethod: 'getTargetFields' },
		default: '',
		description: 'Field from the target profile. Fill the Target Profile field above first. Choose from the list, or specify an ID using an expression. Choose from the list, or specify an ID using an <a href="https://docs.n8n.io/code/expressions/">expression</a>.',
		displayOptions: show({ targetMode: ['profile'] }),
	},
	{
		displayName: 'Target Path',
		name: 'target',
		type: 'string',
		default: '',
		placeholder: 'shipping.cities[*]',
		description:
			'Where to write the value in the output. Each [*] matches a [*] in the source path, in order.',
		displayOptions: show({ targetMode: ['custom'] }),
	},
	{
		displayName: 'Transform',
		name: 'transform',
		type: 'options',
		// eslint-disable-next-line n8n-nodes-base/node-param-options-type-unsorted-items
		options: [
			{ name: 'None', value: 'none' },
			{ name: 'To String', value: 'string' },
			{ name: 'To Number', value: 'number' },
			{ name: 'To Integer', value: 'integer' },
			{ name: 'Round', value: 'round', description: 'Round a number to a number of decimal places' },
			{ name: 'To Boolean', value: 'boolean', description: 'Accepts true/false, yes/no, 1/0, on/off' },
			{ name: 'Trim', value: 'trim' },
			{ name: 'Uppercase', value: 'uppercase' },
			{ name: 'Lowercase', value: 'lowercase' },
			{ name: 'Format Date', value: 'date', description: 'Read a date and write it in another format (UTC)' },
			{ name: 'Split Into List', value: 'split', description: 'Turn "a,b,c" into ["a", "b", "c"]' },
			{ name: 'Join List', value: 'join', description: 'Turn ["a", "b", "c"] into "a,b,c"' },
			{ name: 'Lookup Table', value: 'lookup', description: 'Replace codes using a key=value table' },
		],
		default: 'none',
	},
	{
		displayName: 'Separator',
		name: 'separator',
		type: 'string',
		default: ',',
		displayOptions: show({ transform: ['split', 'join'] }),
	},
	{
		displayName: 'Decimal Places',
		name: 'decimals',
		type: 'number',
		typeOptions: { minValue: 0, maxValue: 15 },
		default: 2,
		displayOptions: show({ transform: ['round'] }),
	},
	{
		displayName: 'Input Date Format',
		name: 'dateInputFormat',
		type: 'string',
		default: '',
		placeholder: 'yyyyMMdd',
		description:
			'Leave empty for ISO 8601 or Unix milliseconds. Tokens: yyyy, MM, dd, HH, mm, ss, SSS.',
		displayOptions: show({ transform: ['date'] }),
	},
	{
		displayName: 'Output Date Format',
		name: 'dateOutputFormat',
		type: 'string',
		default: '',
		placeholder: 'dd/MM/yyyy',
		description: 'Leave empty for ISO 8601. Tokens: yyyy, MM, dd, HH, mm, ss, SSS.',
		displayOptions: show({ transform: ['date'] }),
	},
	{
		displayName: 'Lookup Table',
		name: 'lookupTable',
		type: 'string',
		typeOptions: { rows: 4 },
		default: '',
		placeholder: 'NL=Netherlands\nDE=Germany',
		description: 'One key=value per line, or a JSON object',
		displayOptions: show({ transform: ['lookup'] }),
	},
	{
		displayName: 'If No Match',
		name: 'lookupFallback',
		type: 'options',
		options: [
			{ name: 'Keep Original Value', value: 'keep' },
			{ name: 'Use Default', value: 'default' },
			{ name: 'Set to Null', value: 'null' },
			{ name: 'Stop With Error', value: 'error' },
		],
		default: 'keep',
		displayOptions: show({ transform: ['lookup'] }),
	},
	{
		displayName: 'Lookup Default',
		name: 'lookupDefault',
		type: 'string',
		default: '',
		displayOptions: show({ transform: ['lookup'], lookupFallback: ['default'] }),
	},
	{
		displayName: 'If Source Is Missing',
		name: 'ifMissing',
		type: 'options',
		options: [
			{ name: 'Leave Out', value: 'skip' },
			{ name: 'Set to Null', value: 'null' },
			{ name: 'Use Default', value: 'default' },
			{ name: 'Stop With Error', value: 'error' },
		],
		default: 'skip',
		displayOptions: show({ sourceType: ['field'] }),
	},
	{
		displayName: 'Default Value',
		name: 'defaultValue',
		type: 'string',
		default: '',
		displayOptions: show({ sourceType: ['field'], ifMissing: ['default'] }),
	},
];

const exampleDefinition = JSON.stringify(
	[
		{ source: 'id', target: 'orderId' },
		{ source: 'customer.name', target: 'buyer.name', transform: 'trim' },
		{ source: 'items[*].sku', target: 'lines[*].productCode' },
		{ source: 'items[*].qty', target: 'lines[*].quantity', transform: 'integer' },
		{ value: 'EUR', target: 'lines[*].currency' },
	],
	null,
	2,
);

export class DataMapper implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'Data Mapper',
		name: 'dataMapper',
		icon: { light: 'file:mapper.svg', dark: 'file:mapper.dark.svg' },
		group: ['transform'],
		version: 1,
		subtitle:
			'={{ $parameter["definitionMode"] === "auto" ? "Auto-map from profile" : $parameter["definitionMode"] === "json" ? "JSON definition" : "Field mappings" }}',
		description: 'Map and transform data from one structure to another, between JSON and XML',
		defaults: {
			name: 'Data Mapper',
		},
		inputs: [NodeConnectionTypes.Main],
		outputs: [NodeConnectionTypes.Main],
		usableAsTool: true,
		properties: [
			{
				displayName: 'Input',
				name: 'inputSource',
				type: 'options',
				noDataExpression: true,
				options: [
					{ name: 'Item JSON', value: 'json', description: 'Map the fields of each incoming item' },
					{
						name: 'Text Field',
						value: 'field',
						description: 'Parse JSON or XML text stored in a field first',
					},
					{ name: 'File', value: 'binary', description: 'Parse a JSON or XML file first' },
				],
				default: 'json',
			},
			{
				displayName: 'Input Field',
				name: 'inputField',
				type: 'string',
				default: 'data',
				required: true,
				displayOptions: show({ inputSource: ['field'] }),
			},
			{
				displayName: 'Input Binary Field',
				name: 'inputBinaryField',
				type: 'string',
				default: 'data',
				required: true,
				displayOptions: show({ inputSource: ['binary'] }),
			},
			{
				displayName: 'Input Format',
				name: 'inputFormat',
				type: 'options',
				options: [
					{ name: 'Detect Automatically', value: 'auto' },
					{ name: 'JSON', value: 'json' },
					{ name: 'XML', value: 'xml' },
				],
				default: 'auto',
				description:
					'XML is read with attributes under "$" and text under "_", so a path looks like order.$.ID or order.total._',
				displayOptions: show({ inputSource: ['field', 'binary'] }),
			},
			{
				displayName: 'Define Mappings',
				name: 'definitionMode',
				type: 'options',
				noDataExpression: true,
				options: [
					{ name: 'Using Fields Below', value: 'fields' },
					{
						name: 'Auto-Map From Profile',
						value: 'auto',
						description: 'Match source fields to a target profile automatically by name',
					},
					{
						name: 'Using JSON',
						value: 'json',
						description: 'Paste or reference a mapping definition, so one mapping can be reused across workflows',
					},
				],
				default: 'fields',
			},
			{
				displayName:
					'Define the target structure with a profile, then map into it — pick target fields from a dropdown, or let Auto-Map match them for you',
				name: 'profileNotice',
				type: 'notice',
				default: '',
				displayOptions: show({ definitionMode: ['fields', 'auto'] }),
			},
			{
				displayName: 'Target Profile',
				name: 'targetProfileSource',
				type: 'options',
				options: [
					{
						name: 'Paste It',
						value: 'paste',
						description: 'Paste the profile text. Lets you pick target fields from a dropdown.',
					},
					{
						name: 'Upload a File',
						value: 'binary',
						description:
							'Read the profile from an uploaded file (a binary field from a Read/Write Files, Form or HTTP node)',
					},
				],
				default: 'paste',
				displayOptions: show({ definitionMode: ['fields', 'auto'] }),
			},
			{
				displayName: 'Profile',
				name: 'targetProfile',
				type: 'string',
				typeOptions: { rows: 6 },
				default: '',
				placeholder:
					'Paste a profile component (XML/JSON/Flat File), JSON Schema, sample JSON or XML, XSD, or a CSV header row',
				description: 'The structure to map into. The target fields come from this.',
				displayOptions: show({ definitionMode: ['fields', 'auto'], targetProfileSource: ['paste'] }),
			},
			{
				displayName: 'Profile File Field',
				name: 'profileBinaryField',
				type: 'string',
				default: 'data',
				required: true,
				hint: 'The name of the binary field that holds the uploaded profile file',
				description:
					'Add a Read/Write Files From Disk, Form Trigger (file upload) or HTTP Request node before this one to bring the profile in, then name its binary field here. Auto-Map uses it; the field dropdown is only available when you paste the profile.',
				displayOptions: show({ definitionMode: ['fields', 'auto'], targetProfileSource: ['binary'] }),
			},
			{
				displayName: 'Profile Format',
				name: 'targetProfileFormat',
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
				description: 'The kind of profile you provided. Detect Automatically works for most profiles.',
				displayOptions: show({ definitionMode: ['fields', 'auto'] }),
			},
			{
				displayName: 'Mappings',
				name: 'mappings',
				placeholder: 'Add Mapping',
				type: 'fixedCollection',
				typeOptions: { multipleValues: true, sortable: true },
				default: {},
				description: 'Applied in order; a later mapping to the same target overwrites an earlier one',
				displayOptions: show({ definitionMode: ['fields'] }),
				options: [{ displayName: 'Mapping', name: 'mapping', values: mappingFields }],
			},
			{
				displayName: 'Auto-Map Remaining Target Fields',
				name: 'autoMapRemaining',
				type: 'boolean',
				default: false,
				description:
					'Whether to also fill any target-profile fields you have not mapped above, by matching them to source fields by name',
				displayOptions: show({ definitionMode: ['fields'] }),
			},
			{
				displayName: 'Mapping Definition',
				name: 'mappingJson',
				type: 'json',
				default: exampleDefinition,
				description:
					'An array of mappings, or { "mappings": [...] }. Each mapping has "target" and either "source" or "value", plus optional "transform", "ifMissing", "default", "separator", "decimals", "dateInputFormat", "dateOutputFormat", "lookup", "lookupFallback" and "lookupDefault".',
				displayOptions: show({ definitionMode: ['json'] }),
			},
			{
				displayName: 'Auto-Map Options',
				name: 'autoOptions',
				type: 'collection',
				placeholder: 'Add option',
				default: {},
				displayOptions: show({ definitionMode: ['auto'] }),
				options: [
					{
						displayName: 'Add Auto-Map Report',
						name: 'report',
						type: 'boolean',
						default: false,
						description:
							'Whether to add an _autoMap field listing which fields matched and which did not (JSON output only)',
					},
					{
						displayName: 'Case Sensitive',
						name: 'caseSensitive',
						type: 'boolean',
						default: false,
						description: 'Whether field names must match in the same letter case',
					},
					{
						displayName: 'Match',
						name: 'strategy',
						type: 'options',
						options: [
							{ name: 'Fuzzy (Similar Names)', value: 'fuzzy' },
							{ name: 'Exact Names Only', value: 'exact' },
						],
						default: 'fuzzy',
					},
					{
						displayName: 'Minimum Confidence',
						name: 'threshold',
						type: 'number',
						typeOptions: { minValue: 0, maxValue: 1, numberPrecision: 2 },
						default: 0.6,
						description: 'How close names must be to match, from 0 (match anything) to 1 (identical names)',
					},
					{
						displayName: 'Reuse a Source for Several Targets',
						name: 'reuseSources',
						type: 'boolean',
						default: false,
						description: 'Whether one source field may be mapped to more than one target field',
					},
					{
						displayName: 'Unmatched Target Fields',
						name: 'unmatched',
						type: 'options',
						options: [
							{ name: 'Leave Out', value: 'skip' },
							{ name: 'Set to Null', value: 'null' },
						],
						default: 'skip',
					},
				],
			},
			{
				displayName: 'Unmapped Fields',
				name: 'unmapped',
				type: 'options',
				options: [
					{ name: 'Drop', value: 'drop', description: 'Output only the mapped fields' },
					{
						name: 'Keep',
						value: 'keep',
						description: 'Start from a copy of the input and apply the mappings on top',
					},
				],
				default: 'drop',
			},
			{
				displayName: 'Output Format',
				name: 'outputFormat',
				type: 'options',
				noDataExpression: true,
				options: [
					{ name: 'JSON', value: 'json', description: 'Output the mapped data as the item' },
					{ name: 'JSON File', value: 'jsonFile', description: 'Output the mapped data as a JSON file' },
					{ name: 'XML', value: 'xml', description: 'Output the mapped data as XML text in a field' },
					{ name: 'XML File', value: 'xmlFile', description: 'Output the mapped data as an XML file' },
				],
				default: 'json',
			},
			{
				displayName: 'Put Output in Field',
				name: 'outputField',
				type: 'string',
				default: 'xml',
				required: true,
				displayOptions: show({ outputFormat: ['xml'] }),
			},
			{
				displayName: 'Put Output File in Field',
				name: 'outputBinaryField',
				type: 'string',
				default: 'data',
				required: true,
				displayOptions: show({ outputFormat: ['xmlFile', 'jsonFile'] }),
			},
			{
				displayName: 'File Name',
				name: 'fileName',
				type: 'string',
				default: '',
				placeholder: 'output.xml',
				description: 'Leave empty to name the file output with the matching extension',
				displayOptions: show({ outputFormat: ['xmlFile', 'jsonFile'] }),
			},
			{
				displayName: 'Root Element',
				name: 'rootElement',
				type: 'string',
				default: '',
				placeholder: 'order',
				description:
					'Name of the XML root element. Leave empty to use the single top-level field, or "root" when there are several.',
				displayOptions: show({ outputFormat: ['xml', 'xmlFile'] }),
			},
			{
				displayName: 'Include XML Declaration',
				name: 'xmlDeclaration',
				type: 'boolean',
				default: true,
				description: 'Whether to start the XML with &lt;?xml version="1.0" encoding="UTF-8"?&gt;',
				displayOptions: show({ outputFormat: ['xml', 'xmlFile'] }),
			},
		],
	};

	methods = {
		loadOptions: {
			async getTargetFields(this: ILoadOptionsFunctions): Promise<INodePropertyOptions[]> {
				const source = safeParam(this, 'targetProfileSource') ?? 'paste';
				if (source !== 'paste') {
					return [
						{ name: 'Using An Uploaded File — Use Auto-Map, Or Paste To Pick Fields', value: '' },
					];
				}
				const text = (safeParam(this, 'targetProfile') ?? '').trim();
				if (text === '') return [{ name: 'Paste A Profile First', value: '' }];
				if (text.startsWith('=') || text.includes('{{')) {
					return [{ name: 'Profile Is Set By An Expression — Use Auto-Map To Match Fields', value: '' }];
				}
				const format = (safeParam(this, 'targetProfileFormat') ?? 'auto') as ProfileFormat;
				try {
					const profile = parseProfile(text, format);
					if (profile.fields.length === 0) return [{ name: 'No Fields Found In The Profile', value: '' }];
					return profile.fields.map((field) => ({
						name: `${field.path}${field.repeating ? ' (list)' : ''} [${field.type}]`,
						value: field.path,
					}));
				} catch (error) {
					return [{ name: `Profile Error: ${(error as Error).message}`, value: '' }];
				}
			},
		},
	};

	async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
		const items = this.getInputData();
		const returnData: INodeExecutionData[] = [];
		const profileCache = new Map<string, Profile | undefined>();

		for (let i = 0; i < items.length; i++) {
			try {
				const input = await readInput(this, items[i], i);
				const { rules, report } = await buildRules(this, i, input, profileCache);
				const unmapped = this.getNodeParameter('unmapped', i) as 'drop' | 'keep';
				const start =
					unmapped === 'keep' && input && typeof input === 'object' && !Array.isArray(input)
						? structuredClone(input as Record<string, unknown>)
						: {};
				const mapped = applyMappings(input, rules, start);
				if (report) mapped._autoMap = report;
				returnData.push(await writeOutput(this, mapped, i));
			} catch (error) {
				if (this.continueOnFail()) {
					returnData.push({ json: { error: error.message }, pairedItem: { item: i } });
					continue;
				}
				throw error instanceof NodeOperationError
					? error
					: new NodeOperationError(this.getNode(), error.message, {
							itemIndex: i,
							description:
								error instanceof MappingError ||
								error instanceof XmlParseError ||
								error instanceof ProfileError
									? undefined
									: 'Unexpected error while mapping this item',
						});
			}
		}

		return [returnData];
	}
}

async function readInput(ctx: IExecuteFunctions, item: INodeExecutionData, itemIndex: number): Promise<unknown> {
	const source = ctx.getNodeParameter('inputSource', itemIndex) as InputSource;
	if (source === 'json') return item.json;

	let text: string;
	if (source === 'field') {
		const field = ctx.getNodeParameter('inputField', itemIndex) as string;
		const value = item.json[field];
		if (value === undefined) {
			throw new NodeOperationError(ctx.getNode(), `Input field "${field}" does not exist`, { itemIndex });
		}
		if (typeof value === 'object') return value;
		text = String(value);
	} else {
		const field = ctx.getNodeParameter('inputBinaryField', itemIndex) as string;
		ctx.helpers.assertBinaryData(itemIndex, field);
		text = (await ctx.helpers.getBinaryDataBuffer(itemIndex, field)).toString('utf8');
	}

	const format = ctx.getNodeParameter('inputFormat', itemIndex, 'auto') as InputFormat;
	const trimmed = text.replace(/^\uFEFF/, '').trim();
	const isXml = format === 'xml' || (format === 'auto' && trimmed.startsWith('<'));
	if (isXml) {
		return xmlToJson(parseXml(trimmed), {
			attributes: 'group',
			attributeKey: '$',
			textKey: '_',
			includeRoot: true,
			alwaysArray: false,
			trim: true,
		});
	}
	try {
		return JSON.parse(trimmed);
	} catch (error) {
		throw new NodeOperationError(ctx.getNode(), 'The input is not valid JSON', {
			itemIndex,
			description: error.message,
		});
	}
}

function safeParam(ctx: ILoadOptionsFunctions, name: string): string | undefined {
	try {
		return ctx.getCurrentNodeParameter(name) as string | undefined;
	} catch {
		return undefined;
	}
}

async function getProfile(
	ctx: IExecuteFunctions,
	itemIndex: number,
	cache: Map<string, Profile | undefined>,
): Promise<Profile | undefined> {
	const profileSource = ctx.getNodeParameter('targetProfileSource', itemIndex, 'paste') as 'paste' | 'binary';
	let text: string;
	if (profileSource === 'binary') {
		const field = ctx.getNodeParameter('profileBinaryField', itemIndex) as string;
		ctx.helpers.assertBinaryData(itemIndex, field);
		text = (await ctx.helpers.getBinaryDataBuffer(itemIndex, field)).toString('utf8').trim();
	} else {
		text = ((ctx.getNodeParameter('targetProfile', itemIndex, '') as string) ?? '').trim();
	}
	if (text === '') return undefined;
	const format = ctx.getNodeParameter('targetProfileFormat', itemIndex, 'auto') as ProfileFormat;
	const key = `${format}\u0000${text}`;
	if (!cache.has(key)) cache.set(key, parseProfile(text, format));
	return cache.get(key);
}

function readAutoOptions(ctx: IExecuteFunctions, itemIndex: number): AutoMapOptions {
	const o = ctx.getNodeParameter('autoOptions', itemIndex, {}) as IDataObject;
	return {
		threshold: (o.threshold as number) ?? 0.6,
		strategy: (o.strategy as AutoMapOptions['strategy']) ?? 'fuzzy',
		caseSensitive: o.caseSensitive === true,
		reuseSources: o.reuseSources === true,
		unmatched: (o.unmatched as AutoMapOptions['unmatched']) ?? 'skip',
	};
}

function uiMappingToRule(m: UiMapping, ctx: IExecuteFunctions, itemIndex: number): MappingRule {
	let target = m.target;
	if (m.targetMode === 'profile') {
		target = m.targetField ?? '';
		if (target === '') {
			throw new NodeOperationError(
				ctx.getNode(),
				'A mapping is set to "From Target Profile" but no target field is selected',
				{ itemIndex },
			);
		}
	}
	return {
		...(m.sourceType === 'value' ? { value: m.value ?? '' } : { source: m.source ?? '' }),
		target,
		transform: m.transform,
		separator: m.separator,
		decimals: m.decimals,
		dateInputFormat: m.dateInputFormat,
		dateOutputFormat: m.dateOutputFormat,
		lookup: m.lookupTable,
		lookupFallback: m.lookupFallback,
		lookupDefault: m.lookupDefault,
		ifMissing: m.ifMissing,
		default: m.defaultValue,
	};
}

interface BuiltRules {
	rules: MappingRule[];
	profile?: Profile;
	report?: IDataObject;
}

async function buildRules(
	ctx: IExecuteFunctions,
	itemIndex: number,
	input: unknown,
	cache: Map<string, Profile | undefined>,
): Promise<BuiltRules> {
	const mode = ctx.getNodeParameter('definitionMode', itemIndex) as DefinitionMode;
	if (mode === 'json') return { rules: parseDefinition(ctx.getNodeParameter('mappingJson', itemIndex)) };

	const profile = await getProfile(ctx, itemIndex, cache);

	if (mode === 'auto') {
		if (!profile) {
			throw new NodeOperationError(
				ctx.getNode(),
				'Auto-Map needs a target profile. Paste one in, or upload a profile file.',
				{ itemIndex },
			);
		}
		const options = readAutoOptions(ctx, itemIndex);
		const result = autoMap(flattenSource(input), profile, options);
		const built: BuiltRules = { rules: result.rules, profile };
		if ((ctx.getNodeParameter('autoOptions.report', itemIndex, false) as boolean) === true) {
			built.report = {
				matched: result.matched as unknown as IDataObject[],
				unmatched: result.unmatched,
			};
		}
		return built;
	}

	// fields mode
	const entries = (ctx.getNodeParameter('mappings.mapping', itemIndex, []) as UiMapping[]).filter(Boolean);
	const rules = entries.map((m) => uiMappingToRule(m, ctx, itemIndex));

	if (profile && (ctx.getNodeParameter('autoMapRemaining', itemIndex, false) as boolean) === true) {
		const covered = new Set(rules.map((r) => r.target));
		const remaining: Profile = { ...profile, fields: profile.fields.filter((f) => !covered.has(f.path)) };
		const result = autoMap(flattenSource(input), remaining, {
			threshold: 0.6,
			strategy: 'fuzzy',
			caseSensitive: false,
			reuseSources: false,
			unmatched: 'skip',
		});
		rules.push(...result.rules);
	}

	return { rules, profile };
}

async function writeOutput(
	ctx: IExecuteFunctions,
	mapped: Record<string, unknown>,
	itemIndex: number,
): Promise<INodeExecutionData> {
	const format = ctx.getNodeParameter('outputFormat', itemIndex) as OutputFormat;
	const pairedItem = { item: itemIndex };

	if (format === 'json') return { json: mapped as IDataObject, pairedItem };

	if (format === 'jsonFile') {
		const field = ctx.getNodeParameter('outputBinaryField', itemIndex) as string;
		const fileName = (ctx.getNodeParameter('fileName', itemIndex, '') as string) || 'output.json';
		const binary = await ctx.helpers.prepareBinaryData(
			Buffer.from(JSON.stringify(mapped, null, 2), 'utf8'),
			fileName,
			'application/json',
		);
		return { json: {}, binary: { [field]: binary }, pairedItem };
	}

	const xml = jsonToXml(mapped, {
		rootName: (ctx.getNodeParameter('rootElement', itemIndex, '') as string) || undefined,
		declaration: ctx.getNodeParameter('xmlDeclaration', itemIndex, true) as boolean,
		attributeKey: '$',
		textKey: '_',
	});

	if (format === 'xml') {
		const field = ctx.getNodeParameter('outputField', itemIndex) as string;
		return { json: { [field]: xml }, pairedItem };
	}

	const field = ctx.getNodeParameter('outputBinaryField', itemIndex) as string;
	const fileName = (ctx.getNodeParameter('fileName', itemIndex, '') as string) || 'output.xml';
	const binary = await ctx.helpers.prepareBinaryData(Buffer.from(xml, 'utf8'), fileName, 'application/xml');
	return { json: {}, binary: { [field]: binary }, pairedItem };
}
