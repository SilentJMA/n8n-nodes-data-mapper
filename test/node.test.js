const { test } = require('node:test');
const assert = require('node:assert/strict');
const { DataMapper } = require('../dist/nodes/DataMapper/DataMapper.node');
const { jsonToXml } = require('../dist/nodes/DataMapper/xml');

function run(params, input, { continueOnFail = false, binary = {} } = {}) {
	const ctx = {
		getInputData: () => input,
		getNode: () => ({ name: 'Data Mapper', type: 'dataMapper', typeVersion: 1, parameters: {} }),
		continueOnFail: () => continueOnFail,
		getNodeParameter(name, i, fallback) {
			const value = name.split('.').reduce((o, k) => (o == null ? undefined : o[k]), params);
			return value === undefined ? fallback : value;
		},
		helpers: {
			assertBinaryData: (i, field) => {
				if (!binary[field]) throw new Error(`No binary field "${field}"`);
			},
			getBinaryDataBuffer: async (i, field) => Buffer.from(binary[field]),
			prepareBinaryData: async (buf, fileName, mimeType) => ({ data: buf.toString('utf8'), fileName, mimeType }),
		},
	};
	return new DataMapper().execute.call(ctx);
}

const base = { inputSource: 'json', definitionMode: 'fields', unmapped: 'drop', outputFormat: 'json' };
const uiMapping = (m) => ({ sourceType: 'field', transform: 'none', ifMissing: 'skip', ...m });

test('maps item JSON with UI mappings', async () => {
	const [out] = await run(
		{
			...base,
			mappings: {
				mapping: [
					uiMapping({ source: 'first', target: 'person.name', transform: 'uppercase' }),
					uiMapping({ sourceType: 'value', value: 'web', target: 'person.channel' }),
					uiMapping({ source: 'missing', target: 'person.note', ifMissing: 'default', defaultValue: 'n/a' }),
				],
			},
		},
		[{ json: { first: 'ann', other: 1 } }],
	);
	assert.deepEqual(out[0].json, { person: { name: 'ANN', channel: 'web', note: 'n/a' } });
	assert.deepEqual(out[0].pairedItem, { item: 0 });
});

test('keep unmapped fields', async () => {
	const [out] = await run(
		{ ...base, unmapped: 'keep', mappings: { mapping: [uiMapping({ source: 'a', target: 'b' })] } },
		[{ json: { a: 1, c: { d: 2 } } }],
	);
	assert.deepEqual(out[0].json, { a: 1, c: { d: 2 }, b: 1 });
});

test('JSON definition mode', async () => {
	const [out] = await run(
		{ ...base, definitionMode: 'json', mappingJson: '[{"source":"items[*].id","target":"ids"}]' },
		[{ json: { items: [{ id: 1 }, { id: 2 }] } }],
	);
	assert.deepEqual(out[0].json, { ids: [1, 2] });
});

test('XML text in a field to JSON', async () => {
	const xml = '<?xml version="1.0"?><order ID="7"><line><sku>A</sku></line><line><sku>B</sku></line></order>';
	const [out] = await run(
		{
			...base,
			inputSource: 'field',
			inputField: 'body',
			inputFormat: 'auto',
			definitionMode: 'json',
			mappingJson: [
				{ source: 'order.$.ID', target: 'id', transform: 'integer' },
				{ source: 'order.line[*].sku', target: 'skus' },
			],
		},
		[{ json: { body: xml } }],
	);
	assert.deepEqual(out[0].json, { id: 7, skus: ['A', 'B'] });
});

test('JSON file in, XML text out', async () => {
	const [out] = await run(
		{
			...base,
			inputSource: 'binary',
			inputBinaryField: 'data',
			inputFormat: 'json',
			definitionMode: 'json',
			mappingJson: [
				{ source: 'id', target: 'order.$.id' },
				{ source: 'items[*].sku', target: 'order.line[*].sku' },
				{ source: 'note', target: 'order.note' },
			],
			outputFormat: 'xml',
			outputField: 'xml',
			xmlDeclaration: true,
		},
		[{ json: {} }],
		{ binary: { data: JSON.stringify({ id: 'A1', note: 'Fish & chips', items: [{ sku: 'P-1' }, { sku: 'P-2' }] }) } },
	);
	assert.equal(
		out[0].json.xml,
		[
			'<?xml version="1.0" encoding="UTF-8"?>',
			'<order id="A1">',
			'  <line>',
			'    <sku>P-1</sku>',
			'  </line>',
			'  <line>',
			'    <sku>P-2</sku>',
			'  </line>',
			'  <note>Fish &amp; chips</note>',
			'</order>',
		].join('\n'),
	);
});

test('XML and JSON files out', async () => {
	const params = { ...base, definitionMode: 'json', mappingJson: [{ source: 'a', target: 'x' }, { source: 'b', target: 'y' }], outputBinaryField: 'file' };
	let [out] = await run({ ...params, outputFormat: 'xmlFile', rootElement: 'doc', xmlDeclaration: false }, [{ json: { a: 1, b: 2 } }]);
	assert.equal(out[0].binary.file.data, '<doc>\n  <x>1</x>\n  <y>2</y>\n</doc>');
	assert.equal(out[0].binary.file.fileName, 'output.xml');
	[out] = await run({ ...params, outputFormat: 'jsonFile', fileName: 'm.json' }, [{ json: { a: 1, b: 2 } }]);
	assert.deepEqual(JSON.parse(out[0].binary.file.data), { x: 1, y: 2 });
	assert.equal(out[0].binary.file.mimeType, 'application/json');
});

test('errors name the mapping and respect continueOnFail', async () => {
	const params = { ...base, definitionMode: 'json', mappingJson: [{ source: 'a', target: 'b', transform: 'number' }] };
	await assert.rejects(run(params, [{ json: { a: 'x' } }]), /Mapping 1 \(→ b\): Cannot convert "x" to a number/);
	const [out] = await run(params, [{ json: { a: 'x' } }, { json: { a: '5' } }], { continueOnFail: true });
	assert.match(out[0].json.error, /Cannot convert/);
	assert.deepEqual(out[1].json, { b: 5 });
});

test('missing input field and invalid XML give clear errors', async () => {
	await assert.rejects(run({ ...base, inputSource: 'field', inputField: 'nope', definitionMode: 'json', mappingJson: [] }, [{ json: {} }]), /"nope" does not exist/);
	await assert.rejects(
		run({ ...base, inputSource: 'field', inputField: 'b', inputFormat: 'xml', definitionMode: 'json', mappingJson: [] }, [{ json: { b: '<a><b></a>' } }]),
		/Expected <\/b> but found <\/a>/,
	);
});

test('jsonToXml root handling and invalid names', () => {
	assert.equal(jsonToXml({ a: 1, b: 2 }, { declaration: false, attributeKey: '$', textKey: '_' }), '<root>\n  <a>1</a>\n  <b>2</b>\n</root>');
	assert.equal(jsonToXml({ t: { $: { u: 'x' }, _: 'hi' } }, { declaration: false, attributeKey: '$', textKey: '_' }), '<t u="x">hi</t>');
	assert.throws(() => jsonToXml({ 'bad name': 1 }, { declaration: false, attributeKey: '$', textKey: '_' }), /not a valid XML element name/);
});
