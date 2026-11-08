/** The functions a map can use, grouped like the Functions menu of the visual mapper. */

export type FunctionCategory =
	| 'scripting'
	| 'date'
	| 'language'
	| 'lookup'
	| 'numeric'
	| 'string'
	| 'userDefined';

export type FunctionType =
	| 'script'
	| 'dateFormat'
	| 'currentDate'
	| 'japaneseConvert'
	| 'dataTableLookup'
	| 'simpleLookup'
	| 'sqlLookup'
	| 'mathAbs'
	| 'mathAdd'
	| 'mathSubtract'
	| 'mathMultiply'
	| 'mathDivide'
	| 'mathCeil'
	| 'mathFloor'
	| 'mathPrecision'
	| 'numberFormat'
	| 'runningTotal'
	| 'sum'
	| 'count'
	| 'lineItemIncrement'
	| 'sequentialValue'
	| 'leftTrim'
	| 'rightTrim'
	| 'whitespaceTrim'
	| 'stringAppend'
	| 'stringPrepend'
	| 'stringConcat'
	| 'stringReplace'
	| 'stringRemove'
	| 'toLower'
	| 'toUpper'
	| 'stringSplit'
	| 'userDefined';

/** Type of a script or SQL parameter. The value is converted to this type before use. */
export type PortDataType = 'character' | 'integer' | 'float' | 'datetime';

export interface FunctionPort {
	/** Unique among the inputs (or among the outputs) of one function. */
	key: number;
	name: string;
	/** Used when the input is not mapped, or the mapped value is empty. */
	default?: string;
	dataType?: PortDataType;
}

export type CacheOption = 'none' | 'document' | 'map';

export interface MapFunction {
	/** Unique in the map. Mappings refer to it with `fromFunction` / `toFunction`. */
	key: number;
	type: FunctionType;
	/** Display name. Defaults to the label of the type. */
	name?: string;
	inputs: FunctionPort[];
	outputs: FunctionPort[];
	config?: Record<string, unknown>;
	/** Reuse results for the same inputs: within one item, or for the whole run. */
	cache?: CacheOption;
}

export interface FunctionSpec {
	type: FunctionType;
	category: FunctionCategory;
	label: string;
	description: string;
	inputs: FunctionPort[];
	outputs: FunctionPort[];
	config?: Record<string, unknown>;
	/** The user can add, remove and rename inputs. */
	variableInputs?: boolean;
	/** The user can add, remove and rename outputs. */
	variableOutputs?: boolean;
	/** Offer the cache option (expensive functions only). */
	cacheable?: boolean;
}

const port = (key: number, name: string, def?: string): FunctionPort =>
	def === undefined ? { key, name } : { key, name, default: def };

const RESULT = [port(2, 'Result')];

export const FUNCTION_CATEGORIES: Array<{ value: FunctionCategory; label: string }> = [
	{ value: 'scripting', label: 'Custom Scripting' },
	{ value: 'date', label: 'Date' },
	{ value: 'language', label: 'Language' },
	{ value: 'lookup', label: 'Lookup' },
	{ value: 'numeric', label: 'Numeric' },
	{ value: 'string', label: 'String' },
	{ value: 'userDefined', label: 'User-Defined' },
];

export const FUNCTION_SPECS: FunctionSpec[] = [
	{
		type: 'script',
		category: 'scripting',
		label: 'Scripting',
		description: 'Run inline JavaScript or Python. Inputs and outputs are variables in the script.',
		inputs: [{ key: 1, name: 'input1', dataType: 'character' }],
		outputs: [port(2, 'output1')],
		config: { language: 'javascript', code: 'output1 = input1;' },
		variableInputs: true,
		variableOutputs: true,
		cacheable: true,
	},
	{
		type: 'dateFormat',
		category: 'date',
		label: 'Date Format',
		description: 'Read a date with the input mask and write it with the output mask (UTC).',
		inputs: [
			port(1, 'Date String', ''),
			port(2, 'Input Mask', 'yyyy-MM-dd'),
			port(3, 'Output Mask', "yyyy-MM-dd'T'HH:mm:ss.SSS'Z'"),
		],
		outputs: RESULT,
	},
	{
		type: 'currentDate',
		category: 'date',
		label: 'Get Current Date',
		description: 'The current date and time. Without a mask the result is ISO 8601.',
		inputs: [port(1, 'Output Mask', '')],
		outputs: RESULT,
	},
	{
		type: 'japaneseConvert',
		category: 'language',
		label: 'Japanese Character Conversion',
		description: 'Convert between hiragana, full-width katakana and half-width katakana.',
		inputs: [port(1, 'Original String', '')],
		outputs: RESULT,
		config: { from: 'hiragana', to: 'katakanaFull' },
	},
	{
		type: 'dataTableLookup',
		category: 'lookup',
		label: 'Data Table Lookup',
		description:
			'Find a row in an n8n data table. All inputs must match their columns; the first row wins.',
		inputs: [port(1, 'key')],
		outputs: [port(2, 'value')],
		config: { dataTable: '', inputColumns: { 1: 'key' }, outputColumns: { 2: 'value' } },
		variableInputs: true,
		variableOutputs: true,
		cacheable: true,
	},
	{
		type: 'simpleLookup',
		category: 'lookup',
		label: 'Simple Lookup',
		description: 'Translate a key with a small key/value table stored in the function.',
		inputs: [port(1, 'Key')],
		outputs: [port(1, 'Value')],
		config: { rows: [{ key: 'US', value: 'United States' }] },
	},
	{
		type: 'sqlLookup',
		category: 'lookup',
		label: 'SQL Lookup',
		description:
			'Run a SELECT with ? parameters on the database of the node credential. One output per column.',
		inputs: [{ key: 1, name: 'id', dataType: 'character' }],
		outputs: [{ key: 2, name: 'name', dataType: 'character' }],
		config: { sql: 'SELECT name FROM customers WHERE id = ?' },
		variableInputs: true,
		variableOutputs: true,
		cacheable: true,
	},
	{
		type: 'mathAbs',
		category: 'numeric',
		label: 'Math Absolute Value',
		description: 'Absolute value.',
		inputs: [port(1, 'Value', '')],
		outputs: RESULT,
	},
	{
		type: 'mathAdd',
		category: 'numeric',
		label: 'Math Add',
		description: 'Value + Value to Add (exact decimals).',
		inputs: [port(1, 'Value', ''), port(2, 'Value to Add', '0')],
		outputs: RESULT,
	},
	{
		type: 'mathSubtract',
		category: 'numeric',
		label: 'Math Subtract',
		description: 'Value − Value to Subtract (exact decimals).',
		inputs: [port(1, 'Value', ''), port(2, 'Value to Subtract', '0')],
		outputs: RESULT,
	},
	{
		type: 'mathMultiply',
		category: 'numeric',
		label: 'Math Multiply',
		description: 'Value × Value to Multiply (exact decimals).',
		inputs: [port(1, 'Value', ''), port(2, 'Value to Multiply', '1')],
		outputs: RESULT,
	},
	{
		type: 'mathDivide',
		category: 'numeric',
		label: 'Math Divide',
		description: 'Value ÷ Value to Divide, 10 decimal places, half up. Division by zero fails.',
		inputs: [port(1, 'Value', ''), port(2, 'Value to Divide', '1')],
		outputs: RESULT,
	},
	{
		type: 'mathCeil',
		category: 'numeric',
		label: 'Math Ceil',
		description: 'Round up to a whole number.',
		inputs: [port(1, 'Value', '')],
		outputs: RESULT,
	},
	{
		type: 'mathFloor',
		category: 'numeric',
		label: 'Math Floor',
		description: 'Round down to a whole number.',
		inputs: [port(1, 'Value', '')],
		outputs: RESULT,
	},
	{
		type: 'mathPrecision',
		category: 'numeric',
		label: 'Math Set Precision',
		description: 'Round half up to a number of decimal places and pad with zeros.',
		inputs: [port(1, 'Value', ''), port(2, 'Number of Precision', '2')],
		outputs: RESULT,
	},
	{
		type: 'numberFormat',
		category: 'numeric',
		label: 'Number Format',
		description: 'Reformat a number with masks such as #,##0.00. The result is text.',
		inputs: [
			port(1, 'Number String', ''),
			port(2, 'Input Mask', '#0.00'),
			port(3, 'Output Mask', '#,##0.00'),
		],
		outputs: RESULT,
	},
	{
		type: 'runningTotal',
		category: 'numeric',
		label: 'Running Total',
		description: 'Cumulative total, one value for each record.',
		inputs: [port(1, 'Value to Sum', '')],
		outputs: RESULT,
	},
	{
		type: 'sum',
		category: 'numeric',
		label: 'Sum',
		description: 'One total for each unique Reset Value.',
		inputs: [port(1, 'Value to Sum', ''), port(2, 'Reset Value', '')],
		outputs: RESULT,
	},
	{
		type: 'count',
		category: 'numeric',
		label: 'Count',
		description: 'Counts records where the field exists, for each unique Reset Value.',
		inputs: [port(1, 'Field to Count', ''), port(2, 'Reset Value', '')],
		outputs: RESULT,
	},
	{
		type: 'lineItemIncrement',
		category: 'numeric',
		label: 'Line Item Increment',
		description: '1, 2, 3, … for each record. Restarts when the Reset Value changes.',
		inputs: [port(1, 'Increment Basis', '1'), port(2, 'Reset Value', '')],
		outputs: RESULT,
	},
	{
		type: 'sequentialValue',
		category: 'numeric',
		label: 'Sequential Value',
		description: 'A counter that continues across executions, zero-padded to a fixed length.',
		inputs: [port(1, 'Value', '')],
		outputs: RESULT,
		config: { keyName: 'counter', fixedLength: 6, batchSize: 1 },
	},
	{
		type: 'leftTrim',
		category: 'string',
		label: 'Left Character Trim',
		description: 'Keep the rightmost N characters.',
		inputs: [port(1, 'Original String', ''), port(2, 'Fix to Length', '3')],
		outputs: [port(3, 'Result')],
	},
	{
		type: 'rightTrim',
		category: 'string',
		label: 'Right Character Trim',
		description: 'Keep the leftmost N characters.',
		inputs: [port(1, 'Original String', ''), port(2, 'Fix to Length', '3')],
		outputs: [port(3, 'Result')],
	},
	{
		type: 'whitespaceTrim',
		category: 'string',
		label: 'Whitespace Trim',
		description: 'Remove leading and trailing whitespace.',
		inputs: [port(1, 'Original String', '')],
		outputs: RESULT,
	},
	{
		type: 'stringAppend',
		category: 'string',
		label: 'String Append',
		description: 'Pad on the right to a fixed length with a repeating fill, or cut to it.',
		inputs: [
			port(1, 'Original String', ''),
			port(2, 'Fix to Length', '8'),
			port(3, 'Char to Append', ' '),
		],
		outputs: RESULT,
	},
	{
		type: 'stringPrepend',
		category: 'string',
		label: 'String Prepend',
		description: 'Pad on the left to a fixed length with a repeating fill, or cut to it.',
		inputs: [
			port(1, 'Original String', ''),
			port(2, 'Fix to Length', '8'),
			port(3, 'Char to Prepend', '0'),
		],
		outputs: RESULT,
	},
	{
		type: 'stringConcat',
		category: 'string',
		label: 'String Concat',
		description: 'Join the inputs in order with a delimiter, optionally cut to a fixed length.',
		inputs: [port(1, 'input1', ''), port(2, 'input2', '')],
		outputs: [port(3, 'Result')],
		config: { delimiter: ' ', fixedLength: '' },
		variableInputs: true,
	},
	{
		type: 'stringReplace',
		category: 'string',
		label: 'String Replace',
		description: 'Replace every match of a regular expression. $1 inserts a group.',
		inputs: [
			port(1, 'Original String', ''),
			port(2, 'String to Search', ''),
			port(3, 'String to Replace', ''),
		],
		outputs: [port(4, 'Result')],
	},
	{
		type: 'stringRemove',
		category: 'string',
		label: 'String Remove',
		description: 'Remove every match of a regular expression.',
		inputs: [port(1, 'Original String', ''), port(2, 'String to Remove', '')],
		outputs: [port(3, 'Result')],
	},
	{
		type: 'toLower',
		category: 'string',
		label: 'String To Lower',
		description: 'Lowercase.',
		inputs: [port(1, 'Original String', '')],
		outputs: RESULT,
	},
	{
		type: 'toUpper',
		category: 'string',
		label: 'String To Upper',
		description: 'Uppercase.',
		inputs: [port(1, 'Original String', '')],
		outputs: RESULT,
	},
	{
		type: 'stringSplit',
		category: 'string',
		label: 'String Split',
		description:
			'Split on a delimiter or into fixed-length pieces. More pieces than outputs fails.',
		inputs: [port(1, 'Original String', '')],
		outputs: [port(1, 'output1'), port(2, 'output2')],
		config: { mode: 'delimiter', delimiter: ',', splitLength: 3 },
		variableOutputs: true,
	},
	{
		type: 'userDefined',
		category: 'userDefined',
		label: 'User-Defined',
		description:
			'A chain of function steps. Inside it, one step may feed the next. Steps run in order.',
		inputs: [port(1, 'in1')],
		outputs: [port(1, 'out1')],
		config: { steps: [], links: [] },
		variableInputs: true,
		variableOutputs: true,
	},
];

export const functionSpec = (type: FunctionType): FunctionSpec | undefined =>
	FUNCTION_SPECS.find((spec) => spec.type === type);

/** A new function of a type, with the next free key of the map. */
export function createFunction(type: FunctionType, existing: MapFunction[]): MapFunction {
	const spec = functionSpec(type);
	if (!spec) throw new Error(`Unknown function type "${type}"`);
	const key = existing.reduce((max, fn) => Math.max(max, fn.key), 0) + 1;
	return {
		key,
		type,
		inputs: spec.inputs.map((p) => ({ ...p })),
		outputs: spec.outputs.map((p) => ({ ...p })),
		config: structuredClone(spec.config ?? {}),
		...(spec.cacheable ? { cache: 'none' as const } : {}),
	};
}

export const functionLabel = (fn: MapFunction) =>
	fn.name || functionSpec(fn.type)?.label || fn.type;
