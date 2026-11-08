// Define Mappings > Visual Mapper: the map is stored as JSON text in `visualMapping` and runs like Using JSON.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { DataMapper } = require('../dist/nodes/DataMapper/DataMapper.node');

const input = {
	order: {
		id: 'SO-1',
		customer: { first: 'Ann', last: 'Lee' },
		lines: [{ sku: 'a' }, { sku: 'b' }],
	},
};

const definition = {
	mappings: [
		{ source: 'order.customer.first', target: '', toFunction: 1, toKey: 1 },
		{ source: 'order.customer.last', target: '', toFunction: 1, toKey: 2 },
		{ target: 'Customer.Name', fromFunction: 1, fromKey: 3 },
		{ source: 'order.lines[*].sku', target: 'Items.Item[*].Sku' },
		{ source: 'order.id', target: 'Number' },
	],
	functions: [
		{
			key: 1,
			type: 'stringConcat',
			inputs: [
				{ key: 1, name: 'first' },
				{ key: 2, name: 'last' },
			],
			outputs: [{ key: 3, name: 'Result' }],
			config: { delimiter: ' ', fixedLength: '' },
		},
	],
};

async function run(params) {
	const ctx = {
		getInputData: () => [{ json: input }],
		getNode: () => ({ name: 'Data Mapper', typeVersion: 1 }),
		continueOnFail: () => false,
		getNodeParameter: (name, _i, fallback) =>
			params[name] === undefined ? fallback : params[name],
		getWorkflowStaticData: () => ({}),
		helpers: {},
	};
	const [out] = await new DataMapper().execute.call(ctx);
	return out;
}

const base = {
	inputSource: 'json',
	definitionMode: 'visual',
	visualMapping: JSON.stringify(definition, null, 2),
	unmapped: 'drop',
	targetProfileSource: 'paste',
	targetProfile:
		'<Order><Number>1</Number><Customer><Name>x</Name></Customer><Items><Item><Sku>x</Sku></Item><Item><Sku>y</Sku></Item></Items></Order>',
	targetProfileFormat: 'auto',
};

test('visual mapper: runs the stored definition, in target profile order', async () => {
	const [item] = await run({ ...base, outputFormat: 'json' });
	assert.deepEqual(item.json, {
		Number: 'SO-1',
		Customer: { Name: 'Ann Lee' },
		Items: { Item: [{ Sku: 'a' }, { Sku: 'b' }] },
	});
	assert.deepEqual(Object.keys(item.json), ['Number', 'Customer', 'Items']);
});

test('visual mapper: XML uses the root of a sample XML profile when Root Element is empty', async () => {
	const [item] = await run({
		...base,
		outputFormat: 'xml',
		xmlDeclaration: false,
	});
	assert.match(item.json.xml, /^<Order>/);
	assert.match(item.json.xml, /<Name>Ann Lee<\/Name>/);
});

test('visual mapper: Root Element still wins', async () => {
	const [item] = await run({
		...base,
		outputFormat: 'xml',
		xmlDeclaration: false,
		rootElement: 'Invoice',
	});
	assert.match(item.json.xml, /^<Invoice>/);
});

test('visual mapper: an empty map gives an empty object', async () => {
	const [item] = await run({
		...base,
		visualMapping: '{ "mappings": [], "functions": [] }',
		outputFormat: 'json',
	});
	assert.deepEqual(item.json, {});
});
