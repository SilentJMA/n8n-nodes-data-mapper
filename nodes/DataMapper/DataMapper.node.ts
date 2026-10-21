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
	parseSynonyms,
	ProfileError,
	sourceFields,
	type AutoMapOptions,
	type Profile,
	type ProfileFormat,
} from './profile';
import { buildDropRules, csvText, executeVisual, getProfileFields, orderByProfile, visualProperties } from './visual';
import { jsonToXml, parseXml, xmlToJson, XmlParseError } from './xml';

type InputSource = 'json' | 'field' | 'binary';
type InputFormat = 'auto' | 'json' | 'xml';
type OutputFormat = 'json' | 'xml' | 'csv' | 'xmlFile' | 'jsonFile' | 'csvFile';
type DefinitionMode = 'fields' | 'json' | 'auto';

interface UiMapping {
	sourceType: 'field' | 'value' | 'profile';
	source?: string;
	sourceField?: string;
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

const show = (values: Record<string, Array<string | boolean>>) => ({ show: values });

const transformFields: INodeProperties[] = [
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
];

const mappingFields: INodeProperties[] = [
	{
		displayName: 'Source',
		name: 'sourceType',
		type: 'options',
		options: [
			{ name: 'Input Field', value: 'field', description: 'Read a value from the input by path' },
			{
				name: 'From Source Profile',
				value: 'profile',
				description: 'Pick a field from the source profile',
			},
			{ name: 'Fixed Value', value: 'value', description: 'Write a fixed value or the result of an expression' },
		],
		default: 'field',
	},
	{
		displayName: 'Source Field Name or ID',
		name: 'sourceField',
		type: 'options',
		typeOptions: { loadOptionsMethod: 'getSourceFields' },
		default: '',
		description: 'Field from the source profile. Fill the Source Profile field above first. Choose from the list, or specify an ID using an <a href="https://docs.n8n.io/code/expressions/">expression</a>.',
		displayOptions: show({ sourceType: ['profile'] }),
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
				description: 'Pick a field from the target profile',
			},
		],
		default: 'profile',
	},
	{
		displayName: 'Target Field Name or ID',
		name: 'targetField',
		type: 'options',
		typeOptions: { loadOptionsMethod: 'getTargetFields' },
		default: '',
		description: 'Field from the target profile. Fill the Target Profile field above first. Choose from the list, or specify an ID using an <a href="https://docs.n8n.io/code/expressions/">expression</a>.',
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
	...transformFields,
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
		displayOptions: show({ sourceType: ['field', 'profile'] }),
	},
	{
		displayName: 'Default Value',
		name: 'defaultValue',
		type: 'string',
		default: '',
		displayOptions: show({ sourceType: ['field', 'profile'], ifMissing: ['default'] }),
	},
];

const autoOptionsProperty: INodeProperties = {
	displayName: 'Auto-Map Options',
	name: 'autoOptions',
	type: 'collection',
	placeholder: 'Add option',
	default: {},
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
			displayName: 'Custom Synonyms',
			name: 'synonyms',
			type: 'string',
			typeOptions: { rows: 3 },
			default: '',
			placeholder: 'menge=quantity\nartikel=article',
			description:
				'Extra name matches for auto-map, one source=target per line (or a JSON object). Qty=quantity, Amt=amount and other common abbreviations are already built in.',
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
};

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

const v1Properties: INodeProperties[] = [
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
				description: 'The field that holds the JSON or XML text, e.g. the body of an HTTP Request response',
				displayOptions: show({ inputSource: ['field'] }),
			},
			{
				displayName: 'Input Binary Field',
				name: 'inputBinaryField',
				type: 'string',
				default: 'data',
				required: true,
				hint: 'The name of the binary field that holds the JSON or XML file',
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
				displayName: 'Source Profile',
				name: 'sourceProfile',
				type: 'string',
				typeOptions: { rows: 4 },
				default: '',
				placeholder:
					'Optional: paste the structure of the incoming data (profile component, JSON Schema, sample JSON or XML, XSD, CSV header)',
				description: 'Optional. Describes the incoming data, so you can pick source fields from a dropdown (Source: From Source Profile) instead of typing paths.',
				displayOptions: show({ definitionMode: ['fields'] }),
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
				displayOptions: show({ definitionMode: ['fields'] }),
			},
			{
				displayName:
					'A target profile describes the output structure. With it you can pick target fields from a dropdown or let Auto-Map match them; for one-at-a-time mappings with typed target paths it is optional.',
				name: 'profileNotice',
				type: 'notice',
				default: '',
				displayOptions: show({ definitionMode: ['fields', 'auto'] }),
			},
			{
				displayName: 'Provide Target Profile',
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
				displayName: 'Target Profile',
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
				displayName: 'Target Profile File Field',
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
				displayName: 'Target Profile Format',
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
				displayName: 'Define Mappings',
				name: 'definitionMode',
				type: 'options',
				noDataExpression: true,
				options: [
					{ name: 'Map Each Column Manually', value: 'fields', description: 'Add a mapping per target field' },
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
				displayName: 'Mapping Layout',
				name: 'mappingLayout',
				type: 'options',
				noDataExpression: true,
				options: [
					{ name: 'One Mapping at a Time', value: 'list', description: 'Add a mapping row for each field' },
					{
						name: 'Fill Target Fields',
						value: 'fields',
						description: 'List every target-profile field and set the source for each, like a visual mapper',
					},
				],
				default: 'list',
				displayOptions: show({ definitionMode: ['fields'] }),
			},
			{
				displayName: 'Target Fields',
				name: 'columnMapping',
				type: 'resourceMapper',
				noDataExpression: true,
				default: { mappingMode: 'defineBelow', value: null },
				required: true,
				typeOptions: {
					loadOptionsDependsOn: ['targetProfile', 'targetProfileFormat', 'sourceProfile', 'sourceProfileFormat'],
					resourceMapper: {
						resourceMapperMethod: 'getProfileFields',
						mode: 'add',
						valuesLabel: 'Target Fields',
						fieldWords: { singular: 'target field', plural: 'target fields' },
						addAllFields: true,
						multiKeyMatch: false,
						supportAutoMap: false,
						noFieldsError: 'No target fields found. Paste a target profile above.',
					},
				},
				displayOptions: show({ definitionMode: ['fields'], mappingLayout: ['fields'] }),
			},
			{
				displayName: 'Transform a Field',
				name: 'fieldTransforms',
				placeholder: 'Add Field Transform',
				type: 'fixedCollection',
				typeOptions: { multipleValues: true },
				default: {},
				description:
					'Convert or reformat the target fields above (trim, number, date, lookup, split/join, ...). Pick a field and its transform. Number and boolean types from the profile already convert on their own.',
				displayOptions: show({ definitionMode: ['fields'], mappingLayout: ['fields'] }),
				options: [
					{
						displayName: 'Field',
						name: 'item',
						values: [
							{
								displayName: 'Target Field Name or ID',
								name: 'targetField',
								type: 'options',
								typeOptions: { loadOptionsMethod: 'getTargetFields' },
								default: '',
								description:
									'Which target field to transform. Choose from the list, or specify an ID using an <a href="https://docs.n8n.io/code/expressions/">expression</a>.',
							},
							...transformFields,
						],
					},
				],
			},
			{
				displayName: 'Mappings',
				name: 'mappings',
				placeholder: 'Add Mapping',
				type: 'fixedCollection',
				typeOptions: { multipleValues: true, sortable: true },
				default: {},
				description: 'Applied in order; a later mapping to the same target overwrites an earlier one',
				displayOptions: show({ definitionMode: ['fields'], mappingLayout: ['list'] }),
				options: [{ displayName: 'Mapping', name: 'mapping', values: mappingFields }],
			},
			{
				displayName: 'Auto-Map Remaining Target Fields',
				name: 'autoMapRemaining',
				type: 'boolean',
				default: false,
				description:
					'Whether to also fill any target-profile fields you have not mapped above, by matching them to source fields by name',
				displayOptions: show({ definitionMode: ['fields'], mappingLayout: ['list'] }),
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
			// Shown only where auto-map runs: Auto-Map mode, or Auto-Map Remaining Target Fields.
			{ ...autoOptionsProperty, displayOptions: show({ definitionMode: ['auto'] }) },
			{
				...autoOptionsProperty,
				displayOptions: show({ definitionMode: ['fields'], mappingLayout: ['list'], autoMapRemaining: [true] }),
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
					{ name: 'CSV', value: 'csv', description: 'Output the mapped data as CSV text in a field' },
					{ name: 'CSV File', value: 'csvFile', description: 'Output the mapped data as a CSV file' },
					{ name: 'JSON', value: 'json', description: 'Output the mapped data as the item' },
					{ name: 'JSON File', value: 'jsonFile', description: 'Output the mapped data as a JSON file' },
					{ name: 'XML', value: 'xml', description: 'Output the mapped data as XML text in a field' },
					{ name: 'XML File', value: 'xmlFile', description: 'Output the mapped data as an XML file' },
				],
				default: 'json',
			},
			// One copy per format, so the placeholder and description match the chosen format.
			...(['xml', 'csv'] as const).map(
				(format): INodeProperties => ({
					displayName: 'Put Output in Field',
					name: 'outputField',
					type: 'string',
					default: '',
					placeholder: format,
					description: `Field for the ${format.toUpperCase()} text. Leave empty to use "${format}".`,
					displayOptions: show({ outputFormat: [format] }),
				}),
			),
			{
				displayName: 'Put Output File in Field',
				name: 'outputBinaryField',
				type: 'string',
				default: 'data',
				required: true,
				displayOptions: show({ outputFormat: ['xmlFile', 'jsonFile', 'csvFile'] }),
			},
			...(['xml', 'json', 'csv'] as const).map(
				(ext): INodeProperties => ({
					displayName: 'File Name',
					name: 'fileName',
					type: 'string',
					default: '',
					placeholder: `output.${ext}`,
					description: `Leave empty to name the file output.${ext}`,
					displayOptions: show({ outputFormat: [`${ext}File`] }),
				}),
			),
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
			{
				displayName: 'CSV Options',
				name: 'csvOptions',
				type: 'collection',
				placeholder: 'Add option',
				default: {},
				displayOptions: show({ outputFormat: ['csv', 'csvFile'] }),
				options: [
					{ displayName: 'Delimiter', name: 'csvDelimiter', type: 'string', default: ',' },
					{
						displayName: 'Escape Formulas',
						name: 'csvEscapeFormulas',
						type: 'boolean',
						default: false,
						description:
							"Whether to put ' before values starting with =, +, -, @, tab or CR so spreadsheets don't run them as formulas (CSV injection). Negative numbers then start with ' too.",
					},
					{
						displayName: 'Header Row',
						name: 'csvHeader',
						type: 'boolean',
						default: true,
						description: 'Whether to start the CSV with a row of column names',
					},
					{
						displayName: 'Line Ending',
						name: 'csvLineEnding',
						type: 'options',
						options: [
							{ name: 'LF', value: 'lf' },
							{ name: 'CRLF', value: 'crlf' },
						],
						default: 'lf',
					},
					{
						displayName: 'One CSV for All Items',
						name: 'csvCombine',
						type: 'boolean',
						default: true,
						description: 'Whether to put every item into one CSV document, instead of one CSV per item',
					},
				],
			},
			{
				displayName: 'Options',
				name: 'fieldOptions',
				type: 'collection',
				placeholder: 'Add option',
				default: {},
				displayOptions: show({ definitionMode: ['fields'], mappingLayout: ['fields'] }),
				options: [
					{
						displayName: 'Convert Types From Profile',
						name: 'convertTypes',
						type: 'boolean',
						default: true,
						description:
							'Whether to turn values into numbers or booleans where the profile says so. Values that cannot be converted are kept as they are.',
					},
					{
						displayName: 'Keep Empty Values',
						name: 'keepEmpty',
						type: 'boolean',
						default: false,
						description: 'Whether to write target fields whose value is empty, instead of leaving them out',
					},
				],
			},
		];

function forVersions(properties: INodeProperties[], versions: number[]): INodeProperties[] {
	return properties.map((property) => ({
		...property,
		displayOptions: {
			...property.displayOptions,
			show: { ...property.displayOptions?.show, '@version': versions },
		},
	}));
}

export class DataMapper implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'Data Mapper',
		name: 'dataMapper',
		icon: { light: 'file:mapper.svg', dark: 'file:mapper.dark.svg' },
		group: ['transform'],
		// Version 1 (classic field mappings) is the default. Version 2 (the visual drag-and-drop
		// mapper) stays available so nodes already built with it keep working.
		version: [1, 2],
		defaultVersion: 1,
		subtitle:
			'={{ $parameter["targetFormat"] ? "Map to " + $parameter["targetFormat"].toUpperCase() : ($parameter["definitionMode"] === "auto" ? "Auto-map" : $parameter["definitionMode"] === "json" ? "JSON definition" : "Field mappings") + " → " + { json: "JSON", jsonFile: "JSON file", xml: "XML", xmlFile: "XML file", csv: "CSV", csvFile: "CSV file" }[$parameter["outputFormat"] || "json"] }}',
		description: 'Map and transform data between structures and output XML, JSON or CSV',
		defaults: {
			name: 'Data Mapper',
		},
		inputs: [NodeConnectionTypes.Main],
		outputs: [NodeConnectionTypes.Main],
		usableAsTool: true,
		properties: [...forVersions(v1Properties, [1]), ...forVersions(visualProperties, [2])],
	};

	methods = {
		resourceMapping: {
			getProfileFields,
		},
		loadOptions: {
			async getSourceFields(this: ILoadOptionsFunctions): Promise<INodePropertyOptions[]> {
				const text = (safeParam(this, 'sourceProfile') ?? '').trim();
				if (text === '') return [{ name: 'Paste a Source Profile First', value: '' }];
				if (text.startsWith('=') || text.includes('{{')) {
					return [{ name: 'The Source Profile Is an Expression — Type the Source Path Instead', value: '' }];
				}
				const format = (safeParam(this, 'sourceProfileFormat') ?? 'auto') as ProfileFormat;
				try {
					const fields = sourceFields(parseProfile(text, format));
					if (fields.length === 0) return [{ name: 'No Fields Found in the Source Profile', value: '' }];
					return fields.map((field) => ({
						name: `${field.path}${field.repeating ? ' (list)' : ''} [${field.type}]`,
						value: field.path,
					}));
				} catch (error) {
					return [{ name: `Profile Error: ${(error as Error).message}`, value: '' }];
				}
			},
			async getTargetFields(this: ILoadOptionsFunctions): Promise<INodePropertyOptions[]> {
				const source = safeParam(this, 'targetProfileSource') ?? 'paste';
				if (source !== 'paste') {
					return [
						{ name: 'The Profile Comes From an Uploaded File — Use Auto-Map, or Paste It to Pick Fields', value: '' },
					];
				}
				const text = (safeParam(this, 'targetProfile') ?? '').trim();
				if (text === '') return [{ name: 'Paste a Target Profile First', value: '' }];
				if (text.startsWith('=') || text.includes('{{')) {
					return [{ name: 'The Target Profile Is an Expression — Use Auto-Map to Match Fields', value: '' }];
				}
				const format = (safeParam(this, 'targetProfileFormat') ?? 'auto') as ProfileFormat;
				try {
					const profile = parseProfile(text, format);
					if (profile.fields.length === 0) return [{ name: 'No Fields Found in the Target Profile', value: '' }];
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
		if (this.getNode().typeVersion >= 2) return await executeVisual.call(this);
		const items = this.getInputData();
		const returnData: INodeExecutionData[] = [];
		const profileCache = new Map<string, Profile | undefined>();
		const format0 = this.getNodeParameter('outputFormat', 0, 'json') as OutputFormat;
		const combineCsv =
			(format0 === 'csv' || format0 === 'csvFile') &&
			(this.getNodeParameter('csvOptions.csvCombine', 0, true) as boolean) !== false;
		const csvRecords: Array<{ mapped: Record<string, unknown>; index: number }> = [];
		let csvProfile: Profile | undefined;

		for (let i = 0; i < items.length; i++) {
			try {
				const input = await readInput(this, items[i], i);
				const { rules, report, profile, order } = await buildRules(this, i, input, profileCache);
				const unmapped = this.getNodeParameter('unmapped', i) as 'drop' | 'keep';
				const start =
					unmapped === 'keep' && input && typeof input === 'object' && !Array.isArray(input)
						? structuredClone(input as Record<string, unknown>)
						: {};
				let mapped = applyMappings(input, rules, start);
				if (order && profile) mapped = orderByProfile(mapped, profile);
				// The report is documented as JSON-only; in XML or CSV it would end up in the document.
				const format = this.getNodeParameter('outputFormat', i) as OutputFormat;
				if (report && (format === 'json' || format === 'jsonFile')) mapped._autoMap = report;
				if (combineCsv) {
					csvRecords.push({ mapped, index: i });
					csvProfile ??= profile;
					continue;
				}
				returnData.push(await writeOutput(this, mapped, i, profile));
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

		if (combineCsv && csvRecords.length > 0) {
			const output = await csvOutput(
				this,
				csvRecords.map((r) => r.mapped),
				csvProfile,
				0,
				csvRecords.map((r) => ({ item: r.index })),
			);
			returnData.push(output);
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
		synonyms: parseSynonyms(o.synonyms as string | undefined),
	};
}

function uiMappingToRule(m: UiMapping, ctx: IExecuteFunctions, itemIndex: number): MappingRule {
	let target = m.target;
	// Before 0.4.2 Target defaulted to Custom Path, so saved mappings only carry `target`
	// and now resolve to the new "From Target Profile" default: keep using their path.
	if (m.targetMode === 'profile' && (m.targetField || !m.target)) {
		target = m.targetField ?? '';
		if (target === '') {
			throw new NodeOperationError(
				ctx.getNode(),
				'A mapping is set to "From Target Profile" but no target field is selected',
				{
					itemIndex,
					description:
						'Pick a field from the Target Field dropdown (paste a target profile first), or set Target to Custom Path and type the path.',
				},
			);
		}
	}
	let sourcePart: Partial<MappingRule>;
	if (m.sourceType === 'value') sourcePart = { value: m.value ?? '' };
	else if (m.sourceType === 'profile') {
		if (!m.sourceField) {
			throw new NodeOperationError(
				ctx.getNode(),
				'A mapping is set to "From Source Profile" but no source field is selected',
				{ itemIndex },
			);
		}
		sourcePart = { source: m.sourceField, broadcast: true };
	} else sourcePart = { source: m.source ?? '' };
	return {
		...sourcePart,
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
	/** When true, order the mapped output by the target profile's field order (resource-mapper layout). */
	order?: boolean;
}

interface FieldTransformUi {
	targetField?: string;
	transform?: Transform;
	separator?: string;
	decimals?: number;
	dateInputFormat?: string;
	dateOutputFormat?: string;
	lookupTable?: string;
	lookupFallback?: LookupFallback;
	lookupDefault?: string;
}

/** Applies the per-field transforms (Fill Target Fields layout) onto the rules whose target matches. */
function applyFieldTransforms(ctx: IExecuteFunctions, itemIndex: number, rules: MappingRule[]): void {
	const items = (ctx.getNodeParameter('fieldTransforms.item', itemIndex, []) as FieldTransformUi[]).filter(Boolean);
	for (const it of items) {
		if (!it.targetField || !it.transform || it.transform === 'none') continue;
		for (const rule of rules) {
			if (rule.target !== it.targetField) continue;
			rule.transform = it.transform;
			rule.separator = it.separator;
			rule.decimals = it.decimals;
			rule.dateInputFormat = it.dateInputFormat;
			rule.dateOutputFormat = it.dateOutputFormat;
			rule.lookup = it.lookupTable;
			rule.lookupFallback = it.lookupFallback;
			rule.lookupDefault = it.lookupDefault;
			rule.lenient = true;
		}
	}
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
	if ((ctx.getNodeParameter('mappingLayout', itemIndex, 'list') as string) === 'fields') {
		const raw = (ctx.getNodeParameter('columnMapping.value', itemIndex, {}, {
			rawExpressions: true,
			skipValidation: true,
		}) ?? {}) as Record<string, unknown>;
		const rm = ctx.getNodeParameter('columnMapping', itemIndex, undefined, { skipValidation: true }) as
			| { value?: Record<string, unknown> }
			| undefined;
		const resolved = (rm?.value ?? {}) as Record<string, unknown>;
		const fo = ctx.getNodeParameter('fieldOptions', itemIndex, {}) as IDataObject;
		const rules = buildDropRules(raw, resolved, profile, {
			convertTypes: fo.convertTypes !== false,
			keepEmpty: fo.keepEmpty === true,
		});
		applyFieldTransforms(ctx, itemIndex, rules);
		return { rules, profile, order: true };

	}

	const entries = (ctx.getNodeParameter('mappings.mapping', itemIndex, []) as UiMapping[]).filter(Boolean);
	const rules = entries.map((m) => uiMappingToRule(m, ctx, itemIndex));

	if ((ctx.getNodeParameter('autoMapRemaining', itemIndex, false) as boolean) === true) {
		if (!profile) {
			throw new NodeOperationError(
				ctx.getNode(),
				'Auto-Map Remaining Target Fields needs a target profile. Paste one in, or upload a profile file.',
				{ itemIndex },
			);
		}
		const covered = new Set(rules.map((r) => r.target));
		const remaining: Profile = { ...profile, fields: profile.fields.filter((f) => !covered.has(f.path)) };
		const result = autoMap(flattenSource(input), remaining, readAutoOptions(ctx, itemIndex));
		rules.push(...result.rules);
		if ((ctx.getNodeParameter('autoOptions.report', itemIndex, false) as boolean) === true) {
			return {
				rules,
				profile,
				report: { matched: result.matched as unknown as IDataObject[], unmatched: result.unmatched },
			};
		}
	}

	return { rules, profile };
}

async function csvOutput(
	ctx: IExecuteFunctions,
	records: Record<string, unknown>[],
	profile: Profile | undefined,
	itemIndex: number,
	pairedItem: Array<{ item: number }>,
): Promise<INodeExecutionData> {
	const o = ctx.getNodeParameter('csvOptions', itemIndex, {}) as IDataObject;
	const text = csvText(records, profile, o);
	if ((ctx.getNodeParameter('outputFormat', itemIndex) as OutputFormat) === 'csvFile') {
		const field = ctx.getNodeParameter('outputBinaryField', itemIndex) as string;
		const fileName = (ctx.getNodeParameter('fileName', itemIndex, '') as string) || 'output.csv';
		const binary = await ctx.helpers.prepareBinaryData(Buffer.from(text, 'utf8'), fileName, 'text/csv');
		return { json: {}, binary: { [field]: binary }, pairedItem };
	}
	const field = (ctx.getNodeParameter('outputField', itemIndex, '') as string) || 'csv';
	return { json: { [field]: text }, pairedItem };
}

async function writeOutput(
	ctx: IExecuteFunctions,
	mapped: Record<string, unknown>,
	itemIndex: number,
	profile?: Profile,
): Promise<INodeExecutionData> {
	const format = ctx.getNodeParameter('outputFormat', itemIndex) as OutputFormat;
	const pairedItem = { item: itemIndex };

	if (format === 'json') return { json: mapped as IDataObject, pairedItem };

	if (format === 'csv' || format === 'csvFile') {
		return csvOutput(ctx, [mapped], profile, itemIndex, [pairedItem]);
	}

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
		const field = (ctx.getNodeParameter('outputField', itemIndex, '') as string) || 'xml';
		return { json: { [field]: xml }, pairedItem };
	}

	const field = ctx.getNodeParameter('outputBinaryField', itemIndex) as string;
	const fileName = (ctx.getNodeParameter('fileName', itemIndex, '') as string) || 'output.xml';
	const binary = await ctx.helpers.prepareBinaryData(Buffer.from(xml, 'utf8'), fileName, 'application/xml');
	return { json: {}, binary: { [field]: binary }, pairedItem };
}
