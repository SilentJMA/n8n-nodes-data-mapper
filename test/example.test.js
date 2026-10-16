// Runs the example workflow's Data Mapper nodes against its sample data, so the README examples stay correct.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { DataMapper } = require('../dist/nodes/DataMapper/DataMapper.node');
const workflow = require('../examples/data-mapper-examples.json');

const codeNode = workflow.nodes.find((n) => n.type === 'n8n-nodes-base.code');
const sample = new Function(codeNode.parameters.jsCode)();
const defaults = { inputSource: 'json', definitionMode: 'fields', unmapped: 'drop', outputFormat: 'json', outputField: 'xml', xmlDeclaration: true };

async function runNode(name) {
	const params = { ...defaults, ...workflow.nodes.find((n) => n.name === name).parameters };
	const ctx = {
		getInputData: () => sample,
		getNode: () => ({ name }),
		continueOnFail: () => false,
		getNodeParameter: (p, i, fallback) => {
			const v = p.split('.').reduce((o, k) => (o == null ? undefined : o[k]), params);
			return v === undefined ? fallback : v;
		},
		helpers: {},
	};
	const [out] = await new DataMapper().execute.call(ctx);
	return out[0].json;
}

test('example: restructure order with field mappings', async () => {
	assert.deepEqual(await runNode('Restructure order (fields)'), {
		orderId: 'A1',
		orderDate: '2026-10-17',
		buyer: { name: 'Ann de Vries', country: 'Netherlands' },
		lines: [
			{ productCode: 'P-1', quantity: 2, unitPrice: 10.46, currency: 'EUR' },
			{ productCode: 'P-2', quantity: 1, unitPrice: 3, currency: 'EUR' },
		],
		skuList: 'P-1, P-2',
	});
});

test('example: read supplier XML', async () => {
	assert.deepEqual(await runNode('Read supplier XML (JSON definition)'), {
		supplierOrderId: 7,
		lines: [{ sku: 'A', quantity: 3 }, { sku: 'B', quantity: 1 }],
	});
});

test('example: order as XML', async () => {
	assert.equal(
		(await runNode('Order as XML')).xml,
		[
			'<?xml version="1.0" encoding="UTF-8"?>',
			'<order id="A1">',
			'  <customer>Ann de Vries</customer>',
			'  <line sku="P-1">',
			'    <quantity>2</quantity>',
			'  </line>',
			'  <line sku="P-2">',
			'    <quantity>1</quantity>',
			'  </line>',
			'</order>',
		].join('\n'),
	);
});
