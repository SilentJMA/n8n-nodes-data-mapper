const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
	encodeFieldId,
	decodeFieldId,
	fieldDisplayName,
	parseDragReference,
	buildDropRules,
	getProfileFields,
} = require('../dist/nodes/DataMapper/visual');
const { toCsv } = require('../dist/nodes/DataMapper/csv');
const { applyMappings } = require('../dist/nodes/DataMapper/mapping');
const { DataMapper } = require('../dist/nodes/DataMapper/DataMapper.node');

test('field ids are free of dots and brackets and round-trip', () => {
	for (const path of ['order.line[*].$.sku', 'a', 'x.y.z', 'list[*]', '["first name"].city', 'a[*].b[*].c']) {
		const id = encodeFieldId(path);
		assert.doesNotMatch(id, /[.[\]]/, `id for ${path} contains a dot or bracket: ${id}`);
		assert.equal(decodeFieldId(id), path);
	}
	assert.equal(encodeFieldId('order.line[*].$.sku'), 'order/line/*/$/sku');
	// an unbracketed key with a space is the same field as its bracketed form
	assert.equal(encodeFieldId('Order Id'), encodeFieldId('["Order Id"]'));
});

test('display names read like a tree', () => {
	assert.equal(
		fieldDisplayName({ path: 'order.line[*].$.sku', name: 'sku', type: 'string', repeating: false, required: true }),
		'order › line[] › @sku *',
	);
	assert.equal(
		fieldDisplayName({ path: 'order.total._', name: '_', type: 'number', repeating: false, required: false }),
		'order › total › (text) (number)',
	);
});

test('drag references become source paths, innermost index → [*] for repeating targets', () => {
	assert.equal(parseDragReference('={{ $json.OrderID }}', 0), 'OrderID');
	assert.equal(parseDragReference('={{ $json.Items[0].SKU }}', 1), 'Items[*].SKU');
	assert.equal(parseDragReference('={{ $json.Items[0].SKU }}', 0), 'Items[0].SKU');
	assert.equal(parseDragReference('={{ $json.a[1].b[2].c }}', 1), 'a[1].b[*].c');
	assert.equal(parseDragReference('={{ $json["first name"] }}', 0), '["first name"]');
	assert.equal(parseDragReference('={{ $json.customer?.name }}', 0), 'customer.name');
	// not plain references
	assert.equal(parseDragReference('={{ $json.Name.toUpperCase() }}', 0), undefined);
	assert.equal(parseDragReference('fixed text', 0), undefined);
	assert.equal(parseDragReference("={{ $('Other').item.json.x }}", 0), undefined);
	// a non-array field dropped on a repeating target is not a path reference (it is broadcast instead)
	assert.equal(parseDragReference('={{ $json.Currency }}', 1), undefined);
});

const source = {
	OrderID: 'A1',
	Amount: '129.50',
	Currency: 'eur',
	Items: [
		{ SKU: 'P-1', Qty: '2' },
		{ SKU: 'P-2', Qty: '1' },
	],
};
const profile = {
	kind: 'sampleJson',
	fields: [
		{ path: 'order.$.id', name: 'id', type: 'string', repeating: false, required: false },
		{ path: 'order.total', name: 'total', type: 'number', repeating: false, required: false },
		{ path: 'order.line[*].sku', name: 'sku', type: 'string', repeating: true, required: false },
		{ path: 'order.line[*].qty', name: 'qty', type: 'number', repeating: true, required: false },
		{ path: 'order.line[*].currency', name: 'currency', type: 'string', repeating: true, required: false },
	],
};

test('dropped fields, expressions and fixed values build the target', () => {
	const id = (p) => encodeFieldId(p);
	const raw = {
		[id('order.$.id')]: '={{ $json.OrderID }}',
		[id('order.total')]: '={{ $json.Amount }}',
		[id('order.line[*].sku')]: '={{ $json.Items[0].SKU }}',
		[id('order.line[*].qty')]: '={{ $json.Items[0].Qty }}',
		[id('order.line[*].currency')]: '={{ $json.Currency.toUpperCase() }}',
	};
	const resolved = {
		[id('order.$.id')]: 'A1',
		[id('order.total')]: '129.50',
		[id('order.line[*].sku')]: 'P-1',
		[id('order.line[*].qty')]: '2',
		[id('order.line[*].currency')]: 'EUR',
	};
	const rules = buildDropRules(raw, resolved, profile, { convertTypes: true, keepEmpty: false });
	assert.deepEqual(applyMappings(source, rules, {}), {
		order: {
			$: { id: 'A1' },
			total: 129.5,
			line: [
				{ sku: 'P-1', qty: 2, currency: 'EUR' },
				{ sku: 'P-2', qty: 1, currency: 'EUR' },
			],
		},
	});
});

test('an expression returning a list fills a repeating target element by element', () => {
	const id = encodeFieldId('order.line[*].sku');
	const rules = buildDropRules(
		{ [id]: '={{ $json.Items.map(i => i.SKU.toLowerCase()) }}' },
		{ [id]: ['p-1', 'p-2'] },
		profile,
		{ convertTypes: true, keepEmpty: false },
	);
	assert.deepEqual(applyMappings(source, rules, {}), { order: { line: [{ sku: 'p-1' }, { sku: 'p-2' }] } });
});

test('empty fields are left out unless Keep Empty Values is on; bad numbers are kept, not fatal', () => {
	const total = encodeFieldId('order.total');
	const status = encodeFieldId('order.status');
	assert.deepEqual(
		applyMappings(source, buildDropRules({ [status]: '' }, { [status]: '' }, profile, { convertTypes: true, keepEmpty: false }), {}),
		{},
	);
	assert.deepEqual(
		applyMappings(source, buildDropRules({ [status]: '' }, { [status]: '' }, profile, { convertTypes: true, keepEmpty: true }), {}),
		{ order: { status: '' } },
	);
	assert.deepEqual(
		applyMappings(source, buildDropRules({ [total]: 'n/a' }, { [total]: 'n/a' }, profile, { convertTypes: true, keepEmpty: false }), {}),
		{ order: { total: 'n/a' } },
	);
});

test('CSV writer: header, quoting, and one row per repeating element', () => {
	const csv = toCsv(
		[{ id: 'A1', note: 'a, "b"', lines: [{ sku: 'P-1' }, { sku: 'P-2' }] }],
		[
			{ path: 'id', header: 'id' },
			{ path: 'note', header: 'note' },
			{ path: 'lines[*].sku', header: 'sku' },
		],
		{ delimiter: ',', header: true, lineEnding: '\n' },
	);
	assert.equal(csv, 'id,note,sku\nA1,"a, ""b""",P-1\nA1,"a, ""b""",P-2\n');
});

test('target field list for the mapping widget comes from the pasted profile', async () => {
	const ctx = (params) => ({ getCurrentNodeParameter: (name) => params[name] });
	const empty = await getProfileFields.call(ctx({ targetProfile: '' }));
	assert.equal(empty.fields.length, 0);
	assert.match(empty.emptyFieldsNotice, /Paste a target profile/);
	const loaded = await getProfileFields.call(ctx({ targetProfile: '{"order":{"id":"x","lines":[{"sku":"s","qty":1}]}}' }));
	assert.deepEqual(
		loaded.fields.map((f) => [f.id, f.displayName]),
		[
			['order/id', 'order › id'],
			['order/lines/*/sku', 'order › lines[] › sku'],
			['order/lines/*/qty', 'order › lines[] › qty (number)'],
		],
	);
	const bad = await getProfileFields.call(ctx({ targetProfile: '<broken' }));
	assert.match(bad.emptyFieldsNotice, /Could not read the target profile/);
});

// --- full node, version 2 -------------------------------------------------------

function runV2(params, input, { raw = {}, binary = {}, continueOnFail = false } = {}) {
	const ctx = {
		getInputData: () => input,
		getNode: () => ({ name: 'Data Mapper', type: 'dataMapper', typeVersion: 2, parameters: {} }),
		continueOnFail: () => continueOnFail,
		getNodeParameter(name, i, fallback, opts) {
			if (opts && opts.rawExpressions && name in raw) return raw[name];
			const value = name.split('.').reduce((o, k) => (o == null ? undefined : o[k]), params);
			return value === undefined ? fallback : value;
		},
		helpers: {
			assertBinaryData: (i, f) => {
				if (!binary[f]) throw new Error(`No binary field "${f}"`);
			},
			getBinaryDataBuffer: async (i, f) => Buffer.from(binary[f]),
			prepareBinaryData: async (buf, fileName, mimeType) => ({ data: buf.toString('utf8'), fileName, mimeType }),
		},
	};
	return new DataMapper().execute.call(ctx);
}

const xmlProfile = `<bns:Component xmlns:bns="http://api.platform.example.com/" type="profile.xml"><bns:object><XMLProfile><DataElements>
	<XMLElement name="order" isMappable="false" isNode="true" key="1" maxOccurs="1">
		<XMLAttribute name="id" dataType="character" isMappable="true" key="2"><DataFormat/></XMLAttribute>
		<XMLElement name="currency" dataType="character" isMappable="true" isNode="true" key="3" maxOccurs="1"><DataFormat/></XMLElement>
		<XMLElement name="line" dataType="character" isMappable="false" isNode="true" key="4" maxOccurs="-1">
			<XMLElement name="sku" dataType="character" isMappable="true" isNode="true" key="5" maxOccurs="1"><DataFormat/></XMLElement>
			<XMLElement name="quantity" dataType="number" isMappable="true" isNode="true" key="6" maxOccurs="1"><DataFormat/></XMLElement>
		</XMLElement>
	</XMLElement>
</DataElements></XMLProfile></bns:object></bns:Component>`;

test('v2: drag and drop into an XML target profile', async () => {
	const id = (p) => encodeFieldId(p);
	const raw = {
		[id('order.$.id')]: '={{ $json.OrderID }}',
		[id('order.currency')]: '={{ $json.Currency.toUpperCase() }}',
		[id('order.line[*].sku')]: '={{ $json.Items[0].SKU }}',
		[id('order.line[*].quantity')]: '={{ $json.Items[0].Qty }}',
	};
	const resolved = {
		[id('order.$.id')]: 'A1',
		[id('order.currency')]: 'EUR',
		[id('order.line[*].sku')]: 'P-1',
		[id('order.line[*].quantity')]: '2',
	};
	const [out] = await runV2(
		{
			targetFormat: 'xml',
			targetProfile: xmlProfile,
			mapping: { mappingMode: 'defineBelow', value: resolved },
			outputAs: 'item',
			options: { xmlDeclaration: false },
		},
		[{ json: source }],
		{ raw: { 'mapping.value': raw } },
	);
	assert.equal(
		out[0].json.xml,
		[
			'<order id="A1">',
			'  <currency>EUR</currency>',
			'  <line>',
			'    <sku>P-1</sku>',
			'    <quantity>2</quantity>',
			'  </line>',
			'  <line>',
			'    <sku>P-2</sku>',
			'    <quantity>1</quantity>',
			'  </line>',
			'</order>',
		].join('\n'),
	);
});

test('v2: Map Automatically to JSON with a report', async () => {
	const [out] = await runV2(
		{
			targetFormat: 'json',
			targetProfile: '{"orderId":"s","amount":1,"items":[{"sku":"s","qty":1}]}',
			mapping: { mappingMode: 'autoMapInputData', value: null },
			outputAs: 'item',
			options: { autoMapReport: true },
		},
		[{ json: { OrderID: 'A1', Amount: '9.99', Items: [{ SKU: 'x', Qty: '3' }] } }],
	);
	assert.equal(out[0].json.orderId, 'A1');
	assert.equal(out[0].json.amount, 9.99);
	assert.deepEqual(out[0].json.items, [{ sku: 'x', qty: 3 }]);
	assert.deepEqual(out[0].json._autoMap.unmatched, []);
});

test('v2: CSV for all items in one file, with a CSV header profile', async () => {
	const id = (p) => encodeFieldId(p);
	const items = [{ json: { n: 'A', q: 1 } }, { json: { n: 'B, Inc', q: 2 } }];
	const [out] = await runV2(
		{
			targetFormat: 'csv',
			targetProfile: 'Name;Quantity',
			mapping: { mappingMode: 'defineBelow', value: { [id('Name')]: 'x', [id('Quantity')]: 'y' } },
			outputAs: 'file',
			binaryField: 'data',
			fileName: '',
			options: { csvDelimiter: ';' },
		},
		items,
		{ raw: { 'mapping.value': { [id('Name')]: '={{ $json.n }}', [id('Quantity')]: '={{ $json.q }}' } } },
	);
	assert.equal(out.length, 1);
	assert.deepEqual(out[0].pairedItem, [{ item: 0 }, { item: 1 }]);
	assert.equal(out[0].binary.data.fileName, 'output.csv');
	assert.equal(out[0].binary.data.mimeType, 'text/csv');
	assert.equal(out[0].binary.data.data, 'Name;Quantity\nA;1\nB, Inc;2\n');
});

test('v2: map XML text from a field, error handling with continueOnFail', async () => {
	const [out] = await runV2(
		{
			targetFormat: 'json',
			targetProfile: '{"id":"s"}',
			mapping: { mappingMode: 'autoMapInputData', value: null },
			outputAs: 'item',
			options: { sourceField: 'body' },
		},
		[{ json: { body: '<doc><id>7</id></doc>' } }, { json: { body: 'not json or xml' } }],
		{ continueOnFail: true },
	);
	assert.deepEqual(out[0].json, { id: '7' });
	assert.match(out[1].json.error, /neither valid JSON nor XML/);
});

test('v2: Map Automatically without a profile explains what is missing', async () => {
	await assert.rejects(
		runV2(
			{ targetFormat: 'json', targetProfile: '', mapping: { mappingMode: 'autoMapInputData', value: null }, options: {} },
			[{ json: { a: 1 } }],
		),
		/Map Automatically needs a target profile/,
	);
});

test('node description: v1 is the default, v2 stays for old workflows', () => {
	const d = new DataMapper().description;
	assert.deepEqual(d.version, [1, 2]);
	assert.equal(d.defaultVersion, 1);
	const byName = (n) => d.properties.filter((p) => p.name === n);
	assert.deepEqual(byName('mapping')[0].displayOptions.show['@version'], [2]);
	assert.deepEqual(byName('definitionMode')[0].displayOptions.show['@version'], [1]);
});

test('list positions without a value are skipped, not written empty', () => {
	const id = encodeFieldId('order.line[*].discount');
	const rules = buildDropRules({ [id]: '={{ expr }}' }, { [id]: ['-5.00', null, undefined] }, undefined, {
		convertTypes: false,
		keepEmpty: false,
	});
	const out = applyMappings({}, [{ value: ['a', 'b', 'c'], spread: true, target: 'order.line[*].sku' }, ...rules], {});
	assert.deepEqual(out, { order: { line: [{ sku: 'a', discount: '-5.00' }, { sku: 'b' }, { sku: 'c' }] } });
});
