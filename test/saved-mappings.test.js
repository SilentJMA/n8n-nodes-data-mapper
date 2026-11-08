// Loads saved node parameters the way n8n does before a run or in the editor: NodeHelpers.getNodeParameters
// applies defaults and removes parameters that are not displayed. Mappings must keep their target.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { NodeHelpers } = require('n8n-workflow');
const { DataMapper } = require('../dist/nodes/DataMapper/DataMapper.node');

const description = new DataMapper().description;
const node = {
	name: 'Data Mapper',
	type: 'n8n-nodes-data-mapper.dataMapper',
	typeVersion: 1,
	parameters: {},
};

const input = { id: 'A1', customer: { name: 'Ann' } };

function load(saved) {
	return NodeHelpers.getNodeParameters(
		description.properties,
		saved,
		true,
		false,
		{ ...node, parameters: saved },
		description,
	);
}

async function run(saved) {
	const params = load(saved);
	const ctx = {
		getInputData: () => [{ json: input }],
		getNode: () => ({ ...node, parameters: params }),
		continueOnFail: () => false,
		getNodeParameter: (name, _i, fallback) => {
			const value = name.split('.').reduce((o, k) => (o == null ? undefined : o[k]), params);
			return value === undefined ? fallback : value;
		},
		getWorkflowStaticData: () => ({}),
		helpers: {},
	};
	const [out] = await new DataMapper().execute.call(ctx);
	return { params, json: out[0].json };
}

const mappingsOf = (params) => params.mappings.mapping;

test('mappings saved before 0.4.2 (target path only) keep their target', async () => {
	const saved = {
		mappings: {
			mapping: [
				{ sourceType: 'field', source: 'id', target: 'orderId' },
				{ sourceType: 'field', source: 'customer.name', target: 'buyer.name' },
			],
		},
	};
	const { params, json } = await run(saved);
	assert.deepEqual(
		mappingsOf(params).map((m) => m.target),
		['orderId', 'buyer.name'],
	);
	assert.deepEqual(json, { orderId: 'A1', buyer: { name: 'Ann' } });
});

test('mappings saved with 0.4.2+ (target field from the profile) still use the field', async () => {
	const saved = {
		targetProfile: '{ "orderId": "", "buyer": { "name": "" } }',
		mappings: {
			mapping: [
				{ sourceType: 'field', source: 'id', targetField: 'orderId' },
				{ sourceType: 'field', source: 'customer.name', targetField: 'buyer.name' },
			],
		},
	};
	const { json } = await run(saved);
	assert.deepEqual(json, { orderId: 'A1', buyer: { name: 'Ann' } });
});

test('mappings with Target set to Custom Path use the path', async () => {
	const saved = {
		mappings: {
			mapping: [{ sourceType: 'field', source: 'id', targetMode: 'custom', target: 'order.id' }],
		},
	};
	const { json } = await run(saved);
	assert.deepEqual(json, { order: { id: 'A1' } });
});

test('a picked target field wins over a leftover path', async () => {
	const saved = {
		targetProfile: '{ "orderId": "" }',
		mappings: {
			mapping: [{ sourceType: 'field', source: 'id', targetField: 'orderId', target: 'old.path' }],
		},
	};
	const { params, json } = await run(saved);
	assert.equal(
		mappingsOf(params)[0].target,
		undefined,
		'the path is hidden once a field is picked',
	);
	assert.deepEqual(json, { orderId: 'A1' });
});

test('Custom Path keeps its path even with a leftover target field', async () => {
	const saved = {
		mappings: {
			mapping: [
				{
					sourceType: 'field',
					source: 'id',
					targetMode: 'custom',
					targetField: 'orderId',
					target: 'order.id',
				},
			],
		},
	};
	const { json } = await run(saved);
	assert.deepEqual(json, { order: { id: 'A1' } });
});
