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

const jsonProfile = `<bns:Component xmlns:bns="http://api.platform.example.com/" name="Resp" type="profile.json">
  <bns:object><JSONProfile strict="false"><DataElements>
    <JSONRootValue dataType="character" isMappable="true" key="1" name="Root"><DataFormat/>
      <JSONObject isMappable="false" key="2" name="Object">
        <JSONObjectEntry dataType="character" isMappable="true" key="3" name="orderId"><DataFormat/></JSONObjectEntry>
        <JSONObjectEntry dataType="number" isMappable="true" key="4" name="amount"><DataFormat/></JSONObjectEntry>
      </JSONObject>
    </JSONRootValue>
  </DataElements></JSONProfile></bns:object></bns:Component>`;

test('auto-map mode maps source into a JSON profile component', async () => {
	const [out] = await run(
		{
			...base,
			definitionMode: 'auto',
			targetProfile: jsonProfile,
			targetProfileFormat: 'auto',
			autoOptions: { threshold: 0.6, strategy: 'fuzzy', report: true },
		},
		[{ json: { OrderID: 'A1', Amount: '9.99', other: 'ignore' } }],
	);
	assert.equal(out[0].json.orderId, 'A1');
	assert.equal(out[0].json.amount, 9.99);
	assert.deepEqual(out[0].json._autoMap.unmatched, []);
	assert.equal(out[0].json._autoMap.matched.length, 2);
});

test('auto-map errors without a profile', async () => {
	await assert.rejects(
		run({ ...base, definitionMode: 'auto', targetProfile: '' }, [{ json: { a: 1 } }]),
		/Auto-Map needs a target profile/,
	);
});

test('fields mode: target from profile + auto-map remaining', async () => {
	const [out] = await run(
		{
			...base,
			definitionMode: 'fields',
			targetProfile: jsonProfile,
			autoMapRemaining: true,
			mappings: { mapping: [{ sourceType: 'field', source: 'ref', targetMode: 'profile', targetField: 'orderId', transform: 'none', ifMissing: 'skip' }] },
		},
		[{ json: { ref: 'R-9', amount: '12.50' } }],
	);
	assert.deepEqual(out[0].json, { orderId: 'R-9', amount: 12.5 });
});

test('fields mode: profile target with nothing selected errors', async () => {
	await assert.rejects(
		run(
			{ ...base, definitionMode: 'fields', targetProfile: jsonProfile, autoMapRemaining: false, mappings: { mapping: [{ sourceType: 'field', source: 'a', targetMode: 'profile', targetField: '', transform: 'none', ifMissing: 'skip' }] } },
			[{ json: { a: 1 } }],
		),
		/no target field is selected/,
	);
});

test('auto-map into an XML profile uses its root element for XML output', async () => {
	const xmlProfile = `<bns:Component xmlns:bns="http://api.platform.example.com/" type="profile.xml"><bns:object><XMLProfile><DataElements>
		<XMLElement name="order" isMappable="false" isNode="true" key="1" maxOccurs="1">
			<XMLElement name="id" dataType="character" isMappable="true" isNode="true" key="2" maxOccurs="1"><DataFormat/></XMLElement>
		</XMLElement>
	</DataElements></XMLProfile></bns:object></bns:Component>`;
	const [out] = await run(
		{ ...base, definitionMode: 'auto', targetProfile: xmlProfile, autoOptions: {}, outputFormat: 'xml', outputField: 'xml', rootElement: '', xmlDeclaration: false },
		[{ json: { id: 'A1' } }],
	);
	assert.equal(out[0].json.xml, '<order>\n  <id>A1</id>\n</order>');
});

test('auto-map reads the target profile from an uploaded file', async () => {
	const [out] = await run(
		{
			...base,
			definitionMode: 'auto',
			targetProfileSource: 'binary',
			profileBinaryField: 'profile',
			targetProfileFormat: 'auto',
			autoOptions: {},
		},
		[{ json: { OrderID: 'Z9', Amount: '5' } }],
		{ binary: { profile: jsonProfile } },
	);
	assert.equal(out[0].json.orderId, 'Z9');
	assert.equal(out[0].json.amount, 5);
});

test('v1: CSV output, combined with custom delimiter and escaping', async () => {
	const [out] = await run(
		{
			...base,
			definitionMode: 'json',
			mappingJson: JSON.stringify([{ source: 'id', target: 'Id' }, { source: 'note', target: 'Note' }]),
			outputFormat: 'csv',
			outputField: 'csv',
			csvOptions: { csvDelimiter: ',', csvCombine: true, csvEscapeFormulas: true },
		},
		[{ json: { id: 'A1', note: 'a, "b"' } }, { json: { id: 'B2', note: '=HACK()' } }],
	);
	assert.equal(out.length, 1);
	assert.deepEqual(out[0].pairedItem, [{ item: 0 }, { item: 1 }]);
	assert.equal(out[0].json.csv, 'Id,Note\nA1,"a, ""b"""\nB2,\'=HACK()\n');
});

test('v1: CSV File output, one file per item', async () => {
	const [out] = await run(
		{
			...base,
			definitionMode: 'json',
			mappingJson: JSON.stringify([{ source: 'id', target: 'Id' }]),
			outputFormat: 'csvFile',
			outputBinaryField: 'data',
			fileName: '',
			csvOptions: { csvCombine: false },
		},
		[{ json: { id: 'A1' } }, { json: { id: 'B2' } }],
	);
	assert.equal(out.length, 2);
	assert.equal(out[0].binary.data.fileName, 'output.csv');
	assert.equal(out[0].binary.data.mimeType, 'text/csv');
	assert.equal(out[0].binary.data.data, 'Id\nA1\n');
});

test('mappings saved before 0.4.2 (Custom Path was the default) keep their target path', async () => {
	// n8n fills the new "From Target Profile" default into mappings that only stored `target`
	const [out] = await run(
		{ ...base, mappings: { mapping: [uiMapping({ source: 'id', target: 'orderId', targetMode: 'profile' })] } },
		[{ json: { id: 7 } }],
	);
	assert.deepEqual(out[0].json, { orderId: 7 });
});

test('From Target Profile with no field selected explains how to fix it', async () => {
	await assert.rejects(
		run({ ...base, mappings: { mapping: [uiMapping({ source: 'id', targetMode: 'profile' })] } }, [{ json: { id: 1 } }]),
		(error) => /no target field is selected/.test(error.message) && /Custom Path/.test(error.description),
	);
});

test('Auto-Map Remaining without a target profile fails with a clear message', async () => {
	await assert.rejects(
		run(
			{
				...base,
				autoMapRemaining: true,
				mappings: { mapping: [uiMapping({ source: 'id', target: 'x', targetMode: 'custom' })] },
			},
			[{ json: { id: 1 } }],
		),
		/needs a target profile/,
	);
});

test('auto-map report is added to JSON output only', async () => {
	const params = {
		...base,
		definitionMode: 'auto',
		targetProfile: '{"orderId":"","qty":0}',
		autoOptions: { report: true },
	};
	const input = [{ json: { orderId: 1, Qty: 2 } }];
	const [json] = await run(params, input);
	assert.ok(json[0].json._autoMap);
	const [xml] = await run({ ...params, outputFormat: 'xml' }, input);
	assert.doesNotMatch(xml[0].json.xml, /_autoMap/);
	const [csv] = await run({ ...params, outputFormat: 'csv' }, input);
	assert.doesNotMatch(csv[0].json.csv, /_autoMap/);
});

test('Auto-Map Options only show where auto-map runs', () => {
	const props = new DataMapper().description.properties.filter((p) => p.name === 'autoOptions');
	assert.deepEqual(
		props.map((p) => {
			const { '@version': version, ...rest } = p.displayOptions.show;
			assert.deepEqual(version, [1]);
			return rest;
		}),
		[{ definitionMode: ['auto'] }, { definitionMode: ['fields'], mappingLayout: ['list'], autoMapRemaining: [true] }],
	);
});

test('output field and file name placeholders match the output format', () => {
	const props = new DataMapper().description.properties;
	const placeholder = (name, format) =>
		props.find((p) => p.name === name && p.displayOptions.show.outputFormat?.includes(format))?.placeholder;
	assert.equal(placeholder('outputField', 'xml'), 'xml');
	assert.equal(placeholder('outputField', 'csv'), 'csv');
	assert.equal(placeholder('fileName', 'jsonFile'), 'output.json');
	assert.equal(placeholder('fileName', 'csvFile'), 'output.csv');
});

test('version 2 Target Profile is optional so a profile file can be used instead', () => {
	const prop = new DataMapper().description.properties.find(
		(p) => p.name === 'targetProfile' && p.displayOptions.show['@version'].includes(2),
	);
	assert.notEqual(prop.required, true);
});
