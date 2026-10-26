const { test } = require('node:test');
const assert = require('node:assert/strict');
const { parseProfile, sourceFields } = require('../dist/nodes/DataMapper/profile');
const { applyMappings } = require('../dist/nodes/DataMapper/mapping');
const { encodeFieldId, getProfileFields, SOURCE_PREFIX } = require('../dist/nodes/DataMapper/visual');
const { DataMapper } = require('../dist/nodes/DataMapper/DataMapper.node');

// One-item sample, as people usually have it
const sampleSource = `<Shop><Order>
  <Header><Id>5001</Id><Ref>REF-1</Ref></Header>
  <Delivery><Country>NL</Country></Delivery>
  <Lines><Line><Code>X-1</Code><Qty>2</Qty></Line></Lines>
</Order></Shop>`;

// The real order that comes in later has several items
const realOrder = `<Shop><Order>
  <Header><Id>5002</Id><Ref>REF-2</Ref></Header>
  <Delivery><Country>FR</Country></Delivery>
  <Lines><Line><Code>A-1</Code><Qty>1</Qty></Line><Line><Code>B-2</Code><Qty>3</Qty></Line></Lines>
</Order></Shop>`;

const targetProfile = `<orders><order id="x"><reference>x</reference><country>x</country>
  <lines><line><sku>x</sku><qty>1</qty><currency>x</currency></line><line><sku>y</sku><qty>2</qty><currency>y</currency></line></lines>
</order></orders>`;

test('source profile paths keep the XML root so they match the incoming data', () => {
	const paths = sourceFields(parseProfile(sampleSource)).map((f) => f.path);
	assert.deepEqual(paths, [
		'Shop.Order.Header.Id',
		'Shop.Order.Header.Ref',
		'Shop.Order.Delivery.Country',
		'Shop.Order.Lines.Line.Code',
		'Shop.Order.Lines.Line.Qty',
	]);
	// non-sample-XML profiles are unchanged
	assert.deepEqual(sourceFields(parseProfile('{"a":{"b":1}}')).map((f) => f.path), ['a.b']);
});

test('engine: a picked field without [*] still fills a repeating target from the real lists', () => {
	const many = { Lines: { Line: [{ Code: 'A' }, { Code: 'B' }] } };
	const one = { Lines: { Line: { Code: 'A' } } };
	const rule = { source: 'Lines.Line.Code', target: 'lines[*].sku', broadcast: true };
	assert.deepEqual(applyMappings(many, [rule], {}), { lines: [{ sku: 'A' }, { sku: 'B' }] });
	assert.deepEqual(applyMappings(one, [rule], {}), { lines: [{ sku: 'A' }] });
	// a single value on a repeating target fills every existing element
	assert.deepEqual(
		applyMappings({ ...many, CUR: 'EUR' }, [rule, { source: 'CUR', target: 'lines[*].currency', broadcast: true }], {}),
		{ lines: [{ sku: 'A', currency: 'EUR' }, { sku: 'B', currency: 'EUR' }] },
	);
	// without broadcast the strict check stays
	assert.throws(() => applyMappings(many, [{ source: 'Lines.Line.Code', target: 'lines[*].sku' }], {}), /matching \[\*\]/);
});

test('v2 target fields become source-field dropdowns when a source profile is set', async () => {
	const ctx = (params) => ({ getCurrentNodeParameter: (n) => params[n] });
	const plain = await getProfileFields.call(ctx({ targetProfile }));
	assert.equal(plain.fields[0].type, undefined);
	const withSource = await getProfileFields.call(ctx({ targetProfile, sourceProfile: sampleSource }));
	const first = withSource.fields[0];
	assert.equal(first.type, 'options');
	assert.deepEqual(first.options[0], { name: '(Not Mapped)', value: '' });
	assert.match(first.options[1].name, /Static Text/);
	assert.deepEqual(first.options[2], {
		name: 'Shop › Order › Header › Id',
		value: `${SOURCE_PREFIX}Shop.Order.Header.Id`,
	});
});

function runV2(params, input, raw) {
	const ctx = {
		getInputData: () => input,
		getNode: () => ({ name: 'Data Mapper', typeVersion: 2 }),
		continueOnFail: () => false,
		getNodeParameter(name, i, fallback, opts) {
			if (opts && opts.rawExpressions && name === 'mapping.value') return raw;
			const v = name.split('.').reduce((o, k) => (o == null ? undefined : o[k]), params);
			return v === undefined ? fallback : v;
		},
		helpers: {},
	};
	return new DataMapper().execute.call(ctx);
}

test('v2: XML text in a field, fields picked from a one-item source profile, multi-item order', async () => {
	const id = (p) => encodeFieldId(p);
	const value = {
		[id('order.$.id')]: "={{ 'ORD-' + 'X' }}", // computed expressions still work
		[id('order.reference')]: `${SOURCE_PREFIX}Shop.Order.Header.Ref`,
		[id('order.country')]: `${SOURCE_PREFIX}Shop.Order.Delivery.Country`,
		[id('order.lines.line[*].sku')]: `${SOURCE_PREFIX}Shop.Order.Lines.Line.Code`,
		[id('order.lines.line[*].qty')]: `${SOURCE_PREFIX}Shop.Order.Lines.Line.Qty`,
		[id('order.lines.line[*].currency')]: 'EUR',
	};
	const resolved = { ...value, [id('order.$.id')]: 'ORD-X' };
	const [out] = await runV2(
		{
			targetFormat: 'xml',
			sourceData: 'field',
			sourceDataField: 'data',
			sourceProfile: sampleSource,
			targetProfile,
			mapping: { mappingMode: 'defineBelow', value: resolved },
			outputAs: 'item',
			options: { xmlDeclaration: false },
		},
		[{ json: { data: realOrder } }],
		value,
	);
	assert.equal(
		out[0].json.xml,
		[
			'<orders>',
			'  <order id="ORD-X">',
			'    <reference>REF-2</reference>',
			'    <country>FR</country>',
			'    <lines>',
			'      <line>',
			'        <sku>A-1</sku>',
			'        <qty>1</qty>',
			'        <currency>EUR</currency>',
			'      </line>',
			'      <line>',
			'        <sku>B-2</sku>',
			'        <qty>3</qty>',
			'        <currency>EUR</currency>',
			'      </line>',
			'    </lines>',
			'  </order>',
			'</orders>',
		].join('\n'),
	);
});

test('v1: Source "From Source Profile" lists source fields and maps them', async () => {
	const node = new DataMapper();
	const fields = await node.methods.loadOptions.getSourceFields.call({
		getCurrentNodeParameter: (n) => ({ sourceProfile: sampleSource, sourceProfileFormat: 'auto' })[n],
	});
	assert.equal(fields[0].value, 'Shop.Order.Header.Id');
	assert.match(fields[0].name, /Shop\.Order\.Header\.Id/);

	const params = {
		inputSource: 'field',
		inputField: 'data',
		inputFormat: 'xml',
		definitionMode: 'fields',
		unmapped: 'drop',
		outputFormat: 'json',
		mappings: {
			mapping: [
				{ sourceType: 'profile', sourceField: 'Shop.Order.Lines.Line.Code', targetMode: 'custom', target: 'lines[*].sku', transform: 'none', ifMissing: 'skip' },
			],
		},
	};
	const ctx = {
		getInputData: () => [{ json: { data: realOrder } }],
		getNode: () => ({ name: 'Data Mapper', typeVersion: 1 }),
		continueOnFail: () => false,
		getNodeParameter: (name, i, fallback) => {
			const v = name.split('.').reduce((o, k) => (o == null ? undefined : o[k]), params);
			return v === undefined ? fallback : v;
		},
		helpers: {},
	};
	const [out] = await node.execute.call(ctx);
	assert.deepEqual(out[0].json, { lines: [{ sku: 'A-1' }, { sku: 'B-2' }] });
});

test('v2: a sample-XML target profile supplies its root element automatically', async () => {
	const id = (p) => encodeFieldId(p);
	const [out] = await runV2(
		{
			targetFormat: 'xml',
			targetProfile,
			mapping: { mappingMode: 'defineBelow', value: { [id('order.country')]: 'NL' } },
			outputAs: 'item',
			options: { xmlDeclaration: false },
		},
		[{ json: {} }],
		{ [id('order.country')]: 'NL' },
	);
	assert.equal(out[0].json.xml, '<orders>\n  <order>\n    <country>NL</country>\n  </order>\n</orders>');
});

test('v1 "Fill Target Fields" layout: resource mapper with source-profile picks', async () => {
	const node = new DataMapper();
	const id = (p) => encodeFieldId(p);
	const targetProfile = '{"order":{"id":"x","lines":[{"sku":"s","qty":1}]}}';
	// each target field's value picked from the source profile (src:: prefix) or a fixed value
	const value = {
		[id('order.id')]: `src::Shop.Order.Header.Id`,
		[id('order.lines[*].sku')]: `src::Shop.Order.Lines.Line.Code`,
		[id('order.lines[*].qty')]: `src::Shop.Order.Lines.Line.Qty`,
	};
	const params = {
		inputSource: 'field',
		inputField: 'data',
		inputFormat: 'xml',
		definitionMode: 'fields',
		mappingLayout: 'fields',
		sourceProfile: sampleSource,
		targetProfileSource: 'paste',
		targetProfile,
		targetProfileFormat: 'auto',
		columnMapping: { mappingMode: 'defineBelow', value },
		unmapped: 'drop',
		outputFormat: 'json',
	};
	const ctx = {
		getInputData: () => [{ json: { data: realOrder } }],
		getNode: () => ({ name: 'Data Mapper', typeVersion: 1 }),
		continueOnFail: () => false,
		getNodeParameter(name, i, fb, opts) {
			if (opts && opts.rawExpressions && name === 'columnMapping.value') return value;
			const v = name.split('.').reduce((o, k) => (o == null ? undefined : o[k]), params);
			return v === undefined ? fb : v;
		},
		helpers: {},
	};
	const [out] = await node.execute.call(ctx);
	assert.deepEqual(out[0].json, {
		order: { id: '5002', lines: [{ sku: 'A-1', qty: 1 }, { sku: 'B-2', qty: 3 }] },
	});
});

test('getProfileFields resolves the source dropdown using v1 parameter names', async () => {
	const node = new DataMapper();
	const fields = await node.methods.resourceMapping.getProfileFields.call({
		getCurrentNodeParameter: (n) =>
			({ targetProfile: '{"order":{"id":"x"}}', sourceProfile: sampleSource, sourceProfileFormat: 'auto' })[n],
	});
	// each target field becomes an options dropdown seeded from the source profile
	assert.equal(fields.fields[0].type, 'options');
	assert.ok(fields.fields[0].options.some((o) => o.value === 'src::Shop.Order.Header.Id'));
});


test('v1 Fill Target Fields: Transform a Field reformats the mapped value', async () => {
	const node = new DataMapper();
	const id = (p) => encodeFieldId(p);
	const value = { [id('name')]: 'src::Shop.Order.Delivery.Country', [id('date')]: 'src::Shop.Order.Header.Id' };
	const params = {
		inputSource: 'field', inputField: 'data', inputFormat: 'xml',
		definitionMode: 'fields', mappingLayout: 'fields',
		sourceProfile: sampleSource, targetProfileSource: 'paste',
		targetProfile: '{"name":"x","date":"x"}', targetProfileFormat: 'auto',
		columnMapping: { mappingMode: 'defineBelow', value },
		fieldTransforms: { item: [
			{ targetField: 'name', transform: 'lowercase' },
			{ targetField: 'date', transform: 'date', dateInputFormat: 'yyyy', dateOutputFormat: 'yyyy-MM-dd' },
		] },
		unmapped: 'drop', outputFormat: 'json',
	};
	const ctx = {
		getInputData: () => [{ json: { data: realOrder } }],
		getNode: () => ({ name: 'Data Mapper', typeVersion: 1 }),
		continueOnFail: () => false,
		getNodeParameter(name, i, fb, opts) {
			if (opts && opts.rawExpressions && name === 'columnMapping.value') return value;
			const v = name.split('.').reduce((o, k) => (o == null ? undefined : o[k]), params);
			return v === undefined ? fb : v;
		},
		helpers: {},
	};
	const [out] = await node.execute.call(ctx);
	assert.equal(out[0].json.name, 'fr');
	assert.equal(out[0].json.date, '5002-01-01');
});
