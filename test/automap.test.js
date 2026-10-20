const { test } = require('node:test');
const assert = require('node:assert/strict');
const { autoMap, flattenSource, parseProfile, parseSynonyms } = require('../dist/nodes/DataMapper/profile');
const { encodeFieldId } = require('../dist/nodes/DataMapper/visual');
const { DataMapper } = require('../dist/nodes/DataMapper/DataMapper.node');

const base = { threshold: 0.6, strategy: 'fuzzy', caseSensitive: false, reuseSources: false, unmatched: 'skip' };
function pairs(target, source, options = {}) {
	const r = autoMap(flattenSource(source), parseProfile(JSON.stringify(target)), { ...base, ...options });
	return { matched: r.matched.map((m) => `${m.source}->${m.target}`), unmatched: r.unmatched };
}

test('common abbreviations match the full word (the Qty -> quantity case)', () => {
	const r = pairs(
		{ quantity: 1, amount: 1, description: 'x', number: 1, price: 1 },
		{ Qty: '2', Amt: '9', Desc: 't', Nbr: '5', Price: '1' },
	);
	assert.deepEqual(r.unmatched, []);
	assert.ok(r.matched.includes('Qty->quantity'));
	assert.ok(r.matched.includes('Amt->amount'));
	assert.ok(r.matched.includes('Desc->description'));
	assert.ok(r.matched.includes('Nbr->number'));
});

test('camelCase, snake_case and order-no style names line up', () => {
	const r = pairs(
		{ firstName: 'x', lastName: 'x', postalCode: 'x', orderNumber: 'x', customerName: 'x' },
		{ fname: 'a', Surname: 'b', zip: 'c', OrderNo: 'd', cust_name: 'e' },
	);
	assert.deepEqual(r.unmatched, []);
});

test('British and American spellings match', () => {
	assert.deepEqual(pairs({ color: 'x' }, { colour: 'r' }).unmatched, []);
});

test('unrelated names are left unmatched (no false positives)', () => {
	const r = pairs({ country: 'x', department: 'x' }, { nation: 'n', team: 't' });
	assert.deepEqual(r.matched, []);
	assert.deepEqual(r.unmatched.sort(), ['country', 'department']);
	// a very close pair (one letter) still matches; raise Minimum Confidence to avoid it
	assert.deepEqual(pairs({ weight: 1 }, { height: 2 }).matched, ['height->weight']);
	assert.deepEqual(pairs({ weight: 1 }, { height: 2 }, { threshold: 0.9 }).matched, []);
});

test('exact strategy means literally equal names, not abbreviations', () => {
	assert.deepEqual(pairs({ quantity: 1 }, { Qty: '2' }, { strategy: 'exact' }).matched, []);
	assert.deepEqual(pairs({ quantity: 1 }, { Quantity: '2' }, { strategy: 'exact' }).matched, ['Quantity->quantity']);
});

test('custom synonyms extend the matcher, in both directions', () => {
	const synonyms = parseSynonyms('menge=quantity\nArtikel=article');
	assert.deepEqual(parseSynonyms('{"menge":"quantity"}'), { menge: 'quantity' });
	assert.deepEqual(pairs({ quantity: 1, article: 'x' }, { Menge: '2', Artikel: 'a' }, { synonyms }).unmatched, []);
	// target uses the abbreviation, source the full word
	assert.deepEqual(pairs({ menge: 1 }, { quantity: '2' }, { synonyms }).matched, ['quantity->menge']);
});

test('abbreviations still respect array depth', () => {
	const r = pairs({ lines: [{ sku: 'x', quantity: 1 }] }, { Items: [{ SKU: 'a', Qty: '2' }] });
	assert.deepEqual(r.matched.sort(), ['Items[*].Qty->lines[*].quantity', 'Items[*].SKU->lines[*].sku']);
});

test('v2 Map Automatically maps Qty to quantity end to end', async () => {
	const ctx = {
		getInputData: () => [{ json: { OrderID: 'A1', Qty: '2', Amt: '9.50' } }],
		getNode: () => ({ name: 'Data Mapper', typeVersion: 2 }),
		continueOnFail: () => false,
		getNodeParameter(name, i, fallback) {
			const params = {
				targetFormat: 'json',
				targetProfile: '{"orderId":"x","quantity":1,"amount":1}',
				mapping: { mappingMode: 'autoMapInputData', value: null },
				outputAs: 'item',
				options: {},
			};
			const v = name.split('.').reduce((o, k) => (o == null ? undefined : o[k]), params);
			return v === undefined ? fallback : v;
		},
		helpers: {},
	};
	const [out] = await new DataMapper().execute.call(ctx);
	assert.deepEqual(out[0].json, { orderId: 'A1', quantity: 2, amount: 9.5 });
});

test('v2 Map Automatically honours a custom synonym from options', async () => {
	const ctx = {
		getInputData: () => [{ json: { Menge: '3' } }],
		getNode: () => ({ name: 'Data Mapper', typeVersion: 2 }),
		continueOnFail: () => false,
		getNodeParameter(name, i, fallback) {
			const params = {
				targetFormat: 'json',
				targetProfile: '{"quantity":1}',
				mapping: { mappingMode: 'autoMapInputData', value: null },
				outputAs: 'item',
				options: { synonyms: 'menge=quantity' },
			};
			const v = name.split('.').reduce((o, k) => (o == null ? undefined : o[k]), params);
			return v === undefined ? fallback : v;
		},
		helpers: {},
	};
	const [out] = await new DataMapper().execute.call(ctx);
	assert.deepEqual(out[0].json, { quantity: 3 });
});
