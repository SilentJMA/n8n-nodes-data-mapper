const { test, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const { applyMappings, parseLookupTable } = require('../dist/nodes/DataMapper/mapping');
const { parseXml, xmlToJson, jsonToXml } = require('../dist/nodes/DataMapper/xml');
const { flattenSource, parseProfile } = require('../dist/nodes/DataMapper/profile');
const { parseDragReference } = require('../dist/nodes/DataMapper/visual');

const toJson = (xml) =>
	xmlToJson(parseXml(xml), { attributes: 'group', attributeKey: '$', textKey: '_', includeRoot: true, alwaysArray: false, trim: true });

afterEach(() => {
	delete Object.prototype.polluted;
});

test('target paths cannot pollute Object.prototype', () => {
	const out = applyMappings({ a: 1 }, [{ source: 'a', target: '__proto__.polluted' }], {});
	assert.equal({}.polluted, undefined);
	assert.equal(Object.getPrototypeOf(out), Object.prototype);
	applyMappings({}, [{ value: 'x', target: 'constructor.prototype.polluted' }], {});
	assert.equal({}.polluted, undefined);
	applyMappings({ l: [{ a: 1 }] }, [{ source: 'l[*].a', target: 'x[*].__proto__.polluted' }], {});
	assert.equal({}.polluted, undefined);
});

test('source paths never read inherited members', () => {
	assert.deepEqual(applyMappings({}, [{ source: 'constructor', target: 'a' }, { source: '__proto__', target: 'b' }], {}), {});
});

test('XML element and attribute names cannot change prototypes', () => {
	const json = toJson('<r><__proto__><polluted>1</polluted></__proto__></r>');
	assert.equal({}.polluted, undefined);
	assert.equal(Object.getPrototypeOf(json.r), Object.prototype);
	assert.deepEqual(Object.keys(json.r), ['__proto__']);
	const attrs = parseXml('<r __proto__="x" constructor="y" toString="z"/>').root.attributes;
	assert.equal(Object.getPrototypeOf(attrs), Object.prototype);
	assert.equal(attrs.constructor, 'y');
	assert.throws(() => parseXml('<r a="1" a="2"/>'), /Duplicate attribute "a"/);
	// and writing XML from such data stays safe
	assert.match(jsonToXml({ r: { $: JSON.parse('{"__proto__":"x"}') } }, { declaration: false, attributeKey: '$', textKey: '_' }), /__proto__="x"/);
});

test('lookup tables and profiles with special keys are plain data', () => {
	const table = parseLookupTable('__proto__=x\nconstructor=y');
	assert.equal(Object.getPrototypeOf(table), Object.prototype);
	assert.equal(table.constructor, 'y');
	const profile = parseProfile('<root><__proto__><polluted>1</polluted></__proto__></root>');
	assert.equal({}.polluted, undefined);
	assert.ok(profile.fields.length > 0);
});

test('no external entities or entity expansion', () => {
	const json = toJson(
		'<?xml version="1.0"?><!DOCTYPE r [<!ENTITY x SYSTEM "file:///etc/passwd"><!ENTITY a "AAAA"><!ENTITY b "&a;&a;&a;&a;">]><r>&x;&b;</r>',
	);
	assert.equal(json.r, '&x;&b;');
});

test('deeply nested input fails cleanly instead of exhausting the stack', () => {
	assert.throws(() => parseXml('<a>'.repeat(5000) + '</a>'.repeat(5000)), /nested more than 1000 levels/);
	let deep = 'x';
	for (let i = 0; i < 20000; i++) deep = { a: deep };
	assert.doesNotThrow(() => flattenSource(deep));
});

test('drag-reference parsing stays fast on hostile input', () => {
	for (const evil of ['={{ $json' + '.a'.repeat(50000) + ' ! }}', '={{ $json' + '["a\\'.repeat(20000) + ' }}', '={{ $json' + '[1'.repeat(30000)]) {
		const start = Date.now();
		parseDragReference(evil, 1);
		assert.ok(Date.now() - start < 500);
	}
});
