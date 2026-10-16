const { test } = require('node:test');
const assert = require('node:assert/strict');
const { applyMappings, parsePath, parseDefinition, parseDate, formatDate } = require('../dist/nodes/DataMapper/mapping');

const order = {
	id: 'A1',
	customer: { name: '  Ann  ', country: 'NL', tags: 'vip, early' },
	items: [
		{ sku: 'P-1', qty: '2', price: '10.456', options: [{ code: 'red' }, { code: 'xl' }] },
		{ sku: 'P-2', qty: '1', price: '3', options: [] },
	],
	created: '20261017',
};

test('parses paths', () => {
	assert.deepEqual(parsePath('a.b[0].c[*]["x y"]'), ['a', 'b', 0, 'c', '*', 'x y']);
	assert.deepEqual(parsePath(''), []);
	assert.throws(() => parsePath('a[b]'), /Invalid index/);
});

test('renames and nests fields', () => {
	assert.deepEqual(
		applyMappings(order, [
			{ source: 'id', target: 'orderId' },
			{ source: 'customer.name', target: 'buyer.name', transform: 'trim' },
		]),
		{ orderId: 'A1', buyer: { name: 'Ann' } },
	);
});

test('maps arrays with wildcards and aligns fields by index', () => {
	assert.deepEqual(
		applyMappings(order, [
			{ source: 'items[*].sku', target: 'lines[*].code' },
			{ source: 'items[*].qty', target: 'lines[*].quantity', transform: 'integer' },
			{ source: 'items[*].price', target: 'lines[*].price', transform: 'round', decimals: 2 },
		]),
		{ lines: [{ code: 'P-1', quantity: 2, price: 10.46 }, { code: 'P-2', quantity: 1, price: 3 }] },
	);
});

test('nested wildcards', () => {
	assert.deepEqual(applyMappings(order, [{ source: 'items[*].options[*].code', target: 'l[*].opts[*]' }]), {
		l: [{ opts: ['red', 'xl'] }],
	});
});

test('fewer target wildcards collect values into a list', () => {
	assert.deepEqual(applyMappings(order, [{ source: 'items[*].sku', target: 'skus' }]), { skus: ['P-1', 'P-2'] });
	assert.deepEqual(applyMappings(order, [{ source: 'items[*].options[*].code', target: 'perLine[*].codes' }]), {
		perLine: [{ codes: ['red', 'xl'] }, { codes: [] }],
	});
});

test('more target wildcards than source is an error', () => {
	assert.throws(() => applyMappings(order, [{ source: 'id', target: 'x[*]' }]), /Mapping 1 \(→ x\[\*\]\).*matching \[\*\]/);
});

test('fixed values, including broadcast over an array', () => {
	assert.deepEqual(
		applyMappings(order, [
			{ source: 'items[*].sku', target: 'lines[*].code' },
			{ value: 'EUR', target: 'lines[*].currency' },
			{ value: 'v1', target: 'meta.version' },
		]),
		{ lines: [{ code: 'P-1', currency: 'EUR' }, { code: 'P-2', currency: 'EUR' }], meta: { version: 'v1' } },
	);
});

test('missing values: skip, null, default, error', () => {
	assert.deepEqual(applyMappings(order, [{ source: 'nope', target: 'a' }]), {});
	assert.deepEqual(applyMappings(order, [{ source: 'nope', target: 'a', ifMissing: 'null' }]), { a: null });
	assert.deepEqual(applyMappings(order, [{ source: 'nope', target: 'a', ifMissing: 'default', default: 'x' }]), { a: 'x' });
	assert.throws(() => applyMappings(order, [{ source: 'nope', target: 'a', ifMissing: 'error' }]), /"nope" was not found/);
});

test('transforms', () => {
	const m = (rule) => applyMappings(order, [{ target: 'v', ...rule }]).v;
	assert.equal(m({ source: 'customer.name', transform: 'uppercase' }), '  ANN  ');
	assert.deepEqual(m({ source: 'customer.tags', transform: 'split' }), ['vip', 'early']);
	assert.equal(m({ source: 'items[*].sku', transform: 'join', separator: '|' }), 'P-1|P-2');
	assert.equal(m({ value: 'yes', transform: 'boolean' }), true);
	assert.throws(() => m({ value: 'maybe', transform: 'boolean' }), /boolean/);
	assert.throws(() => m({ value: 'abc', transform: 'number' }), /number/);
	assert.equal(m({ value: 42, transform: 'string' }), '42');
	assert.equal(m({ source: 'created', transform: 'date', dateInputFormat: 'yyyyMMdd', dateOutputFormat: 'dd/MM/yyyy' }), '17/10/2026');
	assert.equal(m({ source: 'customer.country', transform: 'lookup', lookup: 'NL=Netherlands\nDE=Germany' }), 'Netherlands');
	assert.equal(m({ value: 'FR', transform: 'lookup', lookup: '{"NL":"Netherlands"}' }), 'FR');
	assert.equal(m({ value: 'FR', transform: 'lookup', lookup: 'NL=Netherlands', lookupFallback: 'default', lookupDefault: '?' }), '?');
	assert.throws(() => m({ value: 'FR', transform: 'lookup', lookup: 'NL=x', lookupFallback: 'error' }), /No lookup entry/);
});

test('join a collected list', () => {
	const out = applyMappings({ list: ['a', 'b'] }, [{ source: 'list', target: 'v', transform: 'join', separator: '|' }]);
	assert.equal(out.v, 'a|b');
});

test('single object where an array is expected (XML style) works with [*]', () => {
	assert.deepEqual(applyMappings({ order: { line: { sku: 'X' } } }, [{ source: 'order.line[*].sku', target: 'skus' }]), {
		skus: ['X'],
	});
});

test('later mappings overwrite earlier ones and empty source maps the whole input', () => {
	assert.deepEqual(applyMappings({ a: 1, b: 2 }, [{ source: '', target: 'copy' }, { value: 3, target: 'copy.a' }]), {
		copy: { a: 3, b: 2 },
	});
});

test('dates', () => {
	assert.equal(formatDate(parseDate('2026-10-17T08:09:10.011Z'), 'yyyy-MM-dd HH:mm:ss.SSS'), '2026-10-17 08:09:10.011');
	assert.equal(formatDate(parseDate(0)), '1970-01-01T00:00:00.000Z');
	assert.throws(() => parseDate('17-10-2026', 'yyyyMMdd'), /does not match/);
	assert.throws(() => parseDate('not a date'), /Cannot read/);
});

test('definition validation', () => {
	assert.equal(parseDefinition('[{"source":"a","target":"b"}]').length, 1);
	assert.equal(parseDefinition({ mappings: [{ value: 1, target: 'b' }] }).length, 1);
	assert.throws(() => parseDefinition('{oops'), /not valid JSON/);
	assert.throws(() => parseDefinition('{"a":1}'), /must be an array/);
	assert.throws(() => parseDefinition('[{"source":"a"}]'), /needs a "target"/);
	assert.throws(() => parseDefinition('[{"source":"a","target":"b","tranform":"trim"}]'), /unknown property "tranform"/);
});
