const { test } = require('node:test');
const assert = require('node:assert/strict');
const { applyDefinition } = require('../dist/nodes/DataMapper/functions');
const { createFunction } = require('../dist/nodes/DataMapper/function-catalog');
const { convertJapanese } = require('../dist/nodes/DataMapper/japanese');
const { DataMapper } = require('../dist/nodes/DataMapper/DataMapper.node');

const order = {
	order: {
		id: 'SO-1',
		lines: [
			{ sku: 'a1', cat: 'S', amount: '10.25', qty: '2' },
			{ sku: 'b2', cat: 'Z', amount: '5.75', qty: '1' },
			{ sku: 'c3', cat: 'S', amount: '20.00' },
		],
	},
};

const fn = (type, key = 1, patch = {}) => ({ ...createFunction(type, []), key, ...patch });

function counter() {
	let n = 10;
	return { nextSequence: () => ++n };
}

const run = (functions, mappings, input = order) =>
	applyDefinition(input, { functions, mappings }, counter());

test('a mapping may not connect two functions', async () => {
	await assert.rejects(
		run(
			[fn('toUpper', 1), fn('toLower', 2)],
			[{ target: '', fromFunction: 1, fromKey: 2, toFunction: 2, toKey: 1 }],
		),
		/connects two functions/,
	);
});

test('string functions run for every record of a list', async () => {
	const [out] = await run(
		[fn('toUpper')],
		[
			{ source: 'order.lines[*].sku', target: '', toFunction: 1, toKey: 1 },
			{ target: 'items[*].sku', fromFunction: 1, fromKey: 2 },
		],
	);
	assert.deepEqual(out, { items: [{ sku: 'A1' }, { sku: 'B2' }, { sku: 'C3' }] });
});

test('math uses exact decimals and input defaults', async () => {
	const [out] = await run(
		[
			fn('mathAdd', 1, {
				inputs: [
					{ key: 1, name: 'Value' },
					{ key: 2, name: 'Value to Add', default: '0.2' },
				],
			}),
		],
		[
			{ value: '0.1', target: '', toFunction: 1, toKey: 1 },
			{ target: 'total', fromFunction: 1, fromKey: 2 },
		],
	);
	assert.deepEqual(out, { total: 0.3 });
});

test('sum gives one row per group in a list', async () => {
	const [out] = await run(
		[fn('sum')],
		[
			{ source: 'order.lines[*].cat', target: 'subtotals[*].cat' },
			{ source: 'order.lines[*].amount', target: '', toFunction: 1, toKey: 1 },
			{ source: 'order.lines[*].cat', target: '', toFunction: 1, toKey: 2 },
			{ target: 'subtotals[*].amount', fromFunction: 1, fromKey: 2 },
		],
	);
	assert.deepEqual(out, {
		subtotals: [
			{ cat: 'S', amount: 30.25 },
			{ cat: 'Z', amount: 5.75 },
		],
	});
});

test('count counts only records where the field exists', async () => {
	const [out] = await run(
		[fn('count')],
		[
			{ source: 'order.lines[*].qty', target: '', toFunction: 1, toKey: 1 },
			{ target: 'withQty', fromFunction: 1, fromKey: 2 },
		],
	);
	assert.deepEqual(out, { withQty: 2 });
});

test('sequential value numbers the target rows', async () => {
	const [out] = await run(
		[fn('sequentialValue')],
		[
			{ source: 'order.lines[*].sku', target: 'rows[*].sku' },
			{ target: 'rows[*].seq', fromFunction: 1, fromKey: 2 },
		],
	);
	assert.deepEqual(
		out.rows.map((r) => r.seq),
		['000011', '000012', '000013'],
	);
});

test('a split with more pieces than outputs fails', async () => {
	await assert.rejects(
		run(
			[fn('stringSplit')],
			[
				{ value: 'a,b,c', target: '', toFunction: 1, toKey: 1 },
				{ target: 'x', fromFunction: 1, fromKey: 1 },
			],
		),
		/at most 2 outputs but found 3/,
	);
});

test('a user-defined function runs its steps in order', async () => {
	const udf = fn('userDefined', 1, {
		config: {
			steps: [fn('whitespaceTrim', 1), fn('toUpper', 2)],
			links: [
				{ from: 'in:1', to: 'step:1:1' },
				{ from: 'step:1:2', to: 'step:2:1' },
				{ from: 'step:2:2', to: 'out:1' },
			],
		},
	});
	const [out] = await run(
		[udf],
		[
			{ value: '  ann ', target: '', toFunction: 1, toKey: 1 },
			{ target: 'name', fromFunction: 1, fromKey: 1 },
		],
	);
	assert.deepEqual(out, { name: 'ANN' });
});

test('functions that need n8n core report it clearly', async () => {
	await assert.rejects(
		run(
			[fn('sqlLookup')],
			[
				{ value: '1', target: '', toFunction: 1, toKey: 1 },
				{ target: 'name', fromFunction: 1, fromKey: 2 },
			],
		),
		/core Data Mapper only/,
	);
});

test('converts between Japanese scripts', () => {
	assert.equal(convertJapanese('ひらがな', 'hiragana', 'katakanaFull'), 'ヒラガナ');
	assert.equal(convertJapanese('ガギ', 'katakanaFull', 'katakanaHalf'), 'ｶﾞｷﾞ');
	assert.equal(convertJapanese('ｶﾞｷﾞ', 'katakanaHalf', 'hiragana'), 'がぎ');
});

test('node: a JSON definition with functions maps every item', async () => {
	const definition = {
		mappings: [
			{ source: 'order.id', target: 'number' },
			{ source: 'order.lines[*].sku', target: '', toFunction: 1, toKey: 1 },
			{ target: 'lines[*].sku', fromFunction: 1, fromKey: 2 },
			{ target: 'lines[*].no', fromFunction: 2, fromKey: 2 },
		],
		functions: [fn('toUpper', 1), fn('lineItemIncrement', 2)],
	};
	const params = {
		inputSource: 'json',
		definitionMode: 'json',
		mappingJson: JSON.stringify(definition),
		unmapped: 'drop',
		outputFormat: 'json',
	};
	const staticData = {};
	const ctx = {
		getInputData: () => [{ json: order }],
		getNode: () => ({ name: 'Data Mapper', typeVersion: 1 }),
		continueOnFail: () => false,
		getNodeParameter: (name, _i, fallback) =>
			params[name] === undefined ? fallback : params[name],
		getWorkflowStaticData: () => staticData,
		helpers: {},
	};
	const [out] = await new DataMapper().execute.call(ctx);
	assert.deepEqual(out[0].json, {
		number: 'SO-1',
		lines: [
			{ sku: 'A1', no: 1 },
			{ sku: 'B2', no: 2 },
			{ sku: 'C3', no: 3 },
		],
	});
});
