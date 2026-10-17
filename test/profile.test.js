const { test } = require('node:test');
const assert = require('node:assert/strict');
const { parseProfile, detectFormat, flattenSource, autoMap } = require('../dist/nodes/DataMapper/profile');

const fields = (p) => p.fields.map((f) => `${f.path}:${f.type}${f.repeating ? '*' : ''}${f.required ? '!' : ''}`);

const componentXml = `<?xml version="1.0"?>
<bns:Component xmlns:bns="http://api.platform.example.com/" name="Order" type="profile.xml">
  <bns:object>
    <XMLProfile modelVersion="2" strict="true">
      <DataElements>
        <XMLElement name="order" isMappable="false" isNode="true" key="1" maxOccurs="1" minOccurs="1">
          <DataFormat><ProfileCharacterFormat/></DataFormat>
          <XMLAttribute name="id" dataType="character" isMappable="true" key="2" required="true"><DataFormat/></XMLAttribute>
          <XMLElement name="status" dataType="character" isMappable="true" key="3" maxOccurs="1" minOccurs="0"><DataFormat/></XMLElement>
          <XMLElement name="line" dataType="character" isMappable="false" key="4" maxOccurs="-1" minOccurs="0">
            <DataFormat/>
            <XMLElement name="sku" dataType="character" isMappable="true" key="5" maxOccurs="1" minOccurs="1"><DataFormat/></XMLElement>
            <XMLElement name="qty" dataType="number" isMappable="true" key="6" maxOccurs="1" minOccurs="0"><DataFormat/></XMLElement>
          </XMLElement>
        </XMLElement>
      </DataElements>
    </XMLProfile>
  </bns:object>
</bns:Component>`;

test('detects and parses an XML profile component with attributes and repeating elements', () => {
	assert.equal(detectFormat(componentXml), 'component');
	const p = parseProfile(componentXml);
	assert.equal(p.rootName, 'order');
	assert.deepEqual(fields(p), ['order.$.id:string!', 'order.status:string', 'order.line[*].sku:string!', 'order.line[*].qty:number']);
});

const componentJson = `<bns:Component xmlns:bns="http://api.platform.example.com/" name="Resp" type="profile.json">
  <bns:object>
    <JSONProfile strict="false">
      <DataElements>
        <JSONRootValue dataType="character" isMappable="true" isNode="true" key="1" name="Root">
          <DataFormat><ProfileCharacterFormat/></DataFormat>
          <JSONObject isMappable="false" isNode="true" key="2" name="Object">
            <JSONObjectEntry dataType="character" isMappable="true" key="3" name="orderId"><DataFormat/></JSONObjectEntry>
            <JSONObjectEntry dataType="number" isMappable="true" key="4" name="amount"><DataFormat/></JSONObjectEntry>
            <JSONObjectEntry dataType="character" isMappable="false" key="5" name="items">
              <DataFormat/>
              <JSONArray elementType="repeating" key="6" name="items">
                <JSONArrayElement dataType="character" key="7" maxOccurs="-1" minOccurs="0" name="ArrayElement1">
                  <JSONObject isMappable="false" key="8" name="Object">
                    <JSONObjectEntry dataType="character" isMappable="true" key="9" name="sku"><DataFormat/></JSONObjectEntry>
                    <JSONObjectEntry dataType="number" isMappable="true" key="10" name="qty"><DataFormat/></JSONObjectEntry>
                  </JSONObject>
                </JSONArrayElement>
              </JSONArray>
            </JSONObjectEntry>
          </JSONObject>
        </JSONRootValue>
      </DataElements>
    </JSONProfile>
  </bns:object>
</bns:Component>`;

test('parses a JSON profile component, skipping Root/Object wrappers', () => {
	assert.deepEqual(fields(parseProfile(componentJson)), ['orderId:string', 'amount:number', 'items[*].sku:string', 'items[*].qty:number']);
});

const componentFlat = `<bns:Component xmlns:bns="http://api.platform.example.com/" name="CSV" type="profile.flatfile">
  <bns:object>
    <FlatFileProfile modelVersion="2" strict="true">
      <ProfileProperties><GeneralInfo fileType="delimited" useColumnHeaders="true"/></ProfileProperties>
      <DataElements>
        <FlatFileRecord isNode="true" key="1" name="Record">
          <FlatFileElements isNode="true" key="2" name="Elements">
            <FlatFileElement name="OrderId" dataType="character" enforceUnique="false" isMappable="true" key="3"><DataFormat/></FlatFileElement>
            <FlatFileElement name="Total" dataType="number" enforceUnique="false" isMappable="true" key="4" mandatory="true"><DataFormat/></FlatFileElement>
          </FlatFileElements>
        </FlatFileRecord>
      </DataElements>
    </FlatFileProfile>
  </bns:object>
</bns:Component>`;

test('parses a flat file profile component', () => {
	assert.deepEqual(fields(parseProfile(componentFlat)), ['OrderId:string', 'Total:number!']);
});

test('JSON Schema', () => {
	const schema = JSON.stringify({
		type: 'object',
		required: ['id'],
		properties: {
			id: { type: 'integer' },
			when: { type: 'string', format: 'date-time' },
			tags: { type: 'array', items: { type: 'string' } },
			lines: { type: 'array', items: { type: 'object', properties: { sku: { type: 'string' } } } },
		},
	});
	assert.equal(detectFormat(schema), 'jsonSchema');
	assert.deepEqual(fields(parseProfile(schema)), ['id:number!', 'when:datetime', 'tags[*]:string*', 'lines[*].sku:string']);
});

test('sample JSON and sample XML', () => {
	const sj = parseProfile('{"id":"A1","amount":9.99,"items":[{"sku":"x"},{"qty":2}]}');
	assert.equal(sj.kind, 'sampleJson');
	assert.deepEqual(fields(sj), ['id:string', 'amount:number', 'items[*].sku:string', 'items[*].qty:number']);
	const sx = parseProfile('<order id="7"><line><sku>A</sku></line><line><sku>B</sku></line></order>');
	assert.equal(sx.rootName, 'order');
	assert.deepEqual(fields(sx), ['$.id:string', 'line[*].sku:string']);
});

test('CSV header', () => {
	const p = parseProfile('Order Id;Customer Name;Total');
	assert.equal(p.kind, 'csv');
	assert.deepEqual(p.fields.map((f) => f.path), ['Order Id', 'Customer Name', 'Total']);
});

test('flattenSource produces [*] paths', () => {
	assert.deepEqual(
		flattenSource({ id: 'A1', customer: { city: 'Oslo' }, items: [{ sku: 'x', qty: 1 }] }).map((s) => s.path),
		['id', 'customer.city', 'items[*].sku', 'items[*].qty'],
	);
});

const opts = { threshold: 0.6, strategy: 'fuzzy', caseSensitive: false, reuseSources: false, unmatched: 'skip' };

test('autoMap matches by name and assigns type transforms', () => {
	const target = parseProfile(componentJson);
	const sources = flattenSource({ OrderID: 'A1', Amount: '9.99', items: [{ SKU: 'x', Qty: '2' }] });
	const result = autoMap(sources, target, opts);
	assert.deepEqual(result.rules, [
		{ source: 'OrderID', target: 'orderId', transform: 'none' },
		{ source: 'Amount', target: 'amount', transform: 'number' },
		{ source: 'items[*].SKU', target: 'items[*].sku', transform: 'none' },
		{ source: 'items[*].Qty', target: 'items[*].qty', transform: 'number' },
	]);
	assert.equal(result.unmatched.length, 0);
});

test('autoMap respects exact strategy and unmatched=null', () => {
	const target = parseProfile('{"firstName":"s","country":"s"}');
	const sources = flattenSource({ firstNm: 'a', nation: 'b' });
	assert.equal(autoMap(sources, target, { ...opts, strategy: 'exact' }).matched.length, 0);
	const fuzzy = autoMap(sources, target, opts);
	assert.deepEqual(fuzzy.matched.map((m) => `${m.source}->${m.target}`), ['firstNm->firstName']);
	const withNull = autoMap(sources, target, { ...opts, unmatched: 'null' });
	assert.equal(withNull.rules.length, 2);
	assert.equal(withNull.rules.find((r) => r.target === 'country').ifMissing, 'null');
});

test('autoMap will not map a non-repeating source onto a repeating target', () => {
	const target = parseProfile('{"lines":[{"sku":"s"}]}');
	const sources = flattenSource({ sku: 'X' });
	assert.equal(autoMap(sources, target, opts).matched.length, 0);
});
