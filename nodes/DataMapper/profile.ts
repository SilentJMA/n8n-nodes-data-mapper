import { parseXml, XmlParseError, type XmlElement, type XmlNode } from './xml';
import { getOwn, parsePath, setOwn, type MappingRule, type Transform } from './mapping';

/** Data nested deeper than this is not explored when listing fields (protects the stack). */
const MAX_FIELD_DEPTH = 200;

const hasOwn = (container: object, key: string) => Object.prototype.hasOwnProperty.call(container, key);

/** Appends a key to a path, quoting keys that contain dots, brackets, spaces or quotes. */
function joinKey(prefix: string, key: string): string {
	if (/^[^.[\]\s"']+$/.test(key)) return prefix ? `${prefix}.${key}` : key;
	const quoted = key.includes('"') ? `['${key}']` : `["${key}"]`;
	return `${prefix}${quoted}`;
}

export type FieldType = 'string' | 'number' | 'boolean' | 'datetime';
export type ProfileFormat = 'auto' | 'component' | 'jsonSchema' | 'sampleJson' | 'sampleXml' | 'xsd' | 'csv';

export interface ProfileField {
	/** Path in our mapping convention, e.g. order.line[*].sku or container.$.id for an attribute. */
	path: string;
	/** Last segment name, for display and matching. */
	name: string;
	type: FieldType;
	repeating: boolean;
	required: boolean;
}

export interface Profile {
	kind: ProfileFormat;
	/** Root element name, used when writing XML output. */
	rootName?: string;
	/** Leaf fields a value can be written to, in document order. */
	fields: ProfileField[];
}

export class ProfileError extends Error {}

const DATE_HINT = /^\d{4}-\d{2}-\d{2}([T ]\d{2}:\d{2})/;

function dataTypeToField(type: string | undefined): FieldType {
	switch ((type ?? '').toLowerCase()) {
		case 'number':
		case 'integer':
		case 'float':
		case 'double':
		case 'decimal':
			return 'number';
		case 'boolean':
		case 'bit':
			return 'boolean';
		case 'datetime':
		case 'date':
		case 'time':
			return 'datetime';
		default:
			return 'string';
	}
}

function localName(name: string): string {
	const colon = name.indexOf(':');
	return colon === -1 ? name : name.slice(colon + 1);
}

function childElements(element: XmlElement): XmlElement[] {
	return element.children.filter((c): c is XmlElement => c.type === 'element');
}

/** First descendant element whose local name matches, breadth-first. */
function findDescendant(element: XmlElement, name: string): XmlElement | undefined {
	const queue: XmlElement[] = [element];
	while (queue.length > 0) {
		const current = queue.shift()!;
		for (const child of childElements(current)) {
			if (localName(child.name) === name) return child;
			queue.push(child);
		}
	}
	return undefined;
}

export function detectFormat(text: string): ProfileFormat {
	const trimmed = text.replace(/^\uFEFF/, '').trim();
	if (trimmed.startsWith('<')) {
		if (/type\s*=\s*"profile\.(xml|json|flatfile)"/.test(trimmed)) return 'component';
		if (/<(\w+:)?(XMLProfile|JSONProfile|FlatFileProfile)[\s>]/.test(trimmed)) return 'component';
		if (/<(\w+:)?schema[\s>]/.test(trimmed) && /XMLSchema/.test(trimmed)) return 'xsd';
		return 'sampleXml';
	}
	if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
		if (/"\$schema"/.test(trimmed) || /"properties"\s*:/.test(trimmed)) return 'jsonSchema';
		return 'sampleJson';
	}
	return 'csv';
}

export function parseProfile(text: string, format: ProfileFormat = 'auto'): Profile {
	const trimmed = text.replace(/^\uFEFF/, '').trim();
	if (trimmed === '') throw new ProfileError('The target profile is empty');
	const kind = format === 'auto' ? detectFormat(trimmed) : format;

	let result: Profile | undefined;
	let failure: unknown;
	try {
		result = dispatchProfile(kind, trimmed);
	} catch (error) {
		failure = error;
	}
	if (result) return result;
	if (failure instanceof ProfileError) throw failure;
	if (failure instanceof XmlParseError) throw new ProfileError(`Could not read the profile as XML: ${failure.message}`);
	if (failure instanceof SyntaxError) throw new ProfileError(`Could not read the profile as JSON: ${failure.message}`);
	throw failure ?? new ProfileError('Could not read the profile');
}

function dispatchProfile(kind: ProfileFormat, trimmed: string): Profile {
	switch (kind) {
		case 'component':
			return parseComponentProfile(trimmed);
		case 'xsd':
			return parseXsd(trimmed);
		case 'sampleXml':
			return parseSampleXml(trimmed);
		case 'jsonSchema':
			return parseJsonSchema(trimmed);
		case 'sampleJson':
			return parseSampleJson(trimmed);
		case 'csv':
			return parseCsvHeader(trimmed);
		default:
			throw new ProfileError(`Unknown profile format "${kind}"`);
	}
}

// --- Profile components (XML / JSON / Flat File export) -------------------------------------------------

function parseComponentProfile(text: string): Profile {
	const doc = parseXml(text);
	const xml = findDescendant(doc.root, 'XMLProfile') ?? (localName(doc.root.name) === 'XMLProfile' ? doc.root : undefined);
	if (xml) return parseComponentXml(xml);
	const json = findDescendant(doc.root, 'JSONProfile') ?? (localName(doc.root.name) === 'JSONProfile' ? doc.root : undefined);
	if (json) return parseComponentJson(json);
	const flat = findDescendant(doc.root, 'FlatFileProfile') ?? (localName(doc.root.name) === 'FlatFileProfile' ? doc.root : undefined);
	if (flat) return parseComponentFlatFile(flat);
	throw new ProfileError('This XML is not a recognized profile component (XML, JSON or Flat File)');
}

function parseComponentXml(xmlProfile: XmlElement): Profile {
	const dataElements = findDescendant(xmlProfile, 'DataElements');
	if (!dataElements) throw new ProfileError('The XML profile component has no <DataElements>');
	const fields: ProfileField[] = [];
	let rootName: string | undefined;

	const walk = (element: XmlElement, prefix: string, isRoot: boolean) => {
		for (const node of childElements(element)) {
			const name = node.attributes.name;
			// Attributes are emitted by their parent element below, not while walking.
			if (localName(node.name) !== 'XMLElement' || !name) continue;
			if (isRoot && rootName === undefined) rootName = name;
			const repeating = node.attributes.maxOccurs === '-1';
			const path = `${joinKey(prefix, name)}${repeating ? '[*]' : ''}`;
			const kids = childElements(node).filter((c) => localName(c.name) === 'XMLElement');
			const attrs = childElements(node).filter((c) => localName(c.name) === 'XMLAttribute');
			const hasChildElements = kids.length > 0;
			if (!hasChildElements && node.attributes.isMappable !== 'false') {
				fields.push({ path, name, type: dataTypeToField(node.attributes.dataType), repeating, required: node.attributes.minOccurs === '1' });
			}
			for (const attr of attrs) {
				const attrName = attr.attributes.name;
				if (attrName) fields.push({ path: joinKey(`${path}.$`, attrName), name: attrName, type: dataTypeToField(attr.attributes.dataType), repeating: false, required: attr.attributes.required === 'true' });
			}
			if (hasChildElements) walk(node, path, false);
		}
	};
	walk(dataElements, '', true);
	return { kind: 'component', rootName, fields };
}

function parseComponentJson(jsonProfile: XmlElement): Profile {
	const dataElements = findDescendant(jsonProfile, 'DataElements');
	if (!dataElements) throw new ProfileError('The JSON profile component has no <DataElements>');
	const fields: ProfileField[] = [];

	const walkObject = (objectEl: XmlElement, prefix: string) => {
		for (const entry of childElements(objectEl)) {
			if (localName(entry.name) !== 'JSONObjectEntry') continue;
			const name = entry.attributes.name;
			if (!name) continue;
			const nestedObject = childElements(entry).find((c) => localName(c.name) === 'JSONObject');
			const array = childElements(entry).find((c) => localName(c.name) === 'JSONArray');
			if (array) {
				const arrayElement = childElements(array).find((c) => localName(c.name) === 'JSONArrayElement');
				const arrObject = arrayElement && childElements(arrayElement).find((c) => localName(c.name) === 'JSONObject');
				const path = `${joinKey(prefix, name)}[*]`;
				if (arrObject) walkObject(arrObject, path);
				else fields.push({ path, name, type: dataTypeToField(arrayElement?.attributes.dataType), repeating: true, required: false });
			} else if (nestedObject) {
				walkObject(nestedObject, joinKey(prefix, name));
			} else {
				fields.push({ path: joinKey(prefix, name), name, type: dataTypeToField(entry.attributes.dataType), repeating: false, required: false });
			}
		}
	};

	const root = childElements(dataElements).find((c) => localName(c.name) === 'JSONRootValue');
	const rootObject = root && childElements(root).find((c) => localName(c.name) === 'JSONObject');
	if (rootObject) walkObject(rootObject, '');
	else if (root) walkObject(root, '');
	return { kind: 'component', fields };
}

function parseComponentFlatFile(flatProfile: XmlElement): Profile {
	const dataElements = findDescendant(flatProfile, 'DataElements');
	if (!dataElements) throw new ProfileError('The Flat File profile component has no <DataElements>');
	const records = childElements(dataElements).filter((c) => localName(c.name) === 'FlatFileRecord');
	const multi = records.length > 1;
	const fields: ProfileField[] = [];
	for (const record of records) {
		const recordName = record.attributes.name ?? 'Record';
		const elements = findDescendant(record, 'FlatFileElements');
		if (!elements) continue;
		for (const el of childElements(elements)) {
			if (localName(el.name) !== 'FlatFileElement') continue;
			const name = el.attributes.name;
			if (!name || el.attributes.isMappable === 'false') continue;
			fields.push({ path: multi ? joinKey(joinKey('', recordName), name) : joinKey('', name), name, type: dataTypeToField(el.attributes.dataType), repeating: false, required: el.attributes.mandatory === 'true' });
		}
	}
	return { kind: 'component', fields };
}

// --- XSD -----------------------------------------------------------------------

function parseXsd(text: string): Profile {
	const doc = parseXml(text);
	const fields: ProfileField[] = [];
	let rootName: string | undefined;
	const complexTypes = new Map<string, XmlElement>();
	for (const node of descendants(doc.root)) {
		if (localName(node.name) === 'complexType' && node.attributes.name) complexTypes.set(node.attributes.name, node);
	}

	const walk = (element: XmlElement, prefix: string, isRoot: boolean, seen: Set<string>) => {
		const name = element.attributes.name;
		if (!name) return;
		if (isRoot && rootName === undefined) rootName = name;
		const repeating = element.attributes.maxOccurs === 'unbounded' || Number(element.attributes.maxOccurs) > 1;
		const path = `${joinKey(prefix, name)}${repeating ? '[*]' : ''}`;

		let complex = childElements(element).find((c) => localName(c.name) === 'complexType');
		const typeName = element.attributes.type ? localName(element.attributes.type) : undefined;
		if (!complex && typeName && complexTypes.has(typeName) && !seen.has(typeName)) complex = complexTypes.get(typeName);

		if (complex) {
			const next = typeName ? new Set([...seen, typeName]) : seen;
			for (const child of descendants(complex)) {
				if (localName(child.name) === 'element') walk(child, path, false, next);
				if (localName(child.name) === 'attribute' && child.attributes.name) {
					fields.push({ path: joinKey(`${path}.$`, child.attributes.name), name: child.attributes.name, type: dataTypeToField(localName(child.attributes.type ?? '')), repeating: false, required: child.attributes.use === 'required' });
				}
			}
		} else {
			fields.push({ path, name, type: dataTypeToField(typeName), repeating, required: element.attributes.minOccurs !== '0' });
		}
	};

	const roots = childElements(doc.root).filter((c) => localName(c.name) === 'element');
	for (const root of roots) walk(root, '', true, new Set());
	if (fields.length === 0) throw new ProfileError('No elements found in the XSD');
	return { kind: 'xsd', rootName, fields };
}

function* descendants(element: XmlElement): Generator<XmlElement> {
	for (const child of childElements(element)) {
		yield child;
		yield* descendants(child);
	}
}

// --- JSON Schema ---------------------------------------------------------------

function parseJsonSchema(text: string): Profile {
	const schema = JSON.parse(text) as Record<string, unknown>;
	const fields: ProfileField[] = [];

	const walk = (node: unknown, prefix: string) => {
		if (!node || typeof node !== 'object') return;
		const s = node as Record<string, unknown>;
		const type = Array.isArray(s.type) ? (s.type as string[]).find((t) => t !== 'null') : (s.type as string | undefined);
		if (type === 'object' || s.properties) {
			const props = (s.properties ?? {}) as Record<string, unknown>;
			const required = new Set((s.required as string[]) ?? []);
			for (const [key, child] of Object.entries(props)) {
				walkField(key, child, prefix, required.has(key));
			}
		}
	};
	const walkField = (key: string, child: unknown, prefix: string, required: boolean) => {
		const c = (child ?? {}) as Record<string, unknown>;
		const type = Array.isArray(c.type) ? (c.type as string[]).find((t) => t !== 'null') : (c.type as string | undefined);
		if (type === 'object' || c.properties) {
			walk(c, `${prefix}${key}.`);
		} else if (type === 'array' && c.items) {
			const items = c.items as Record<string, unknown>;
			const itemType = items.type as string | undefined;
			if (itemType === 'object' || items.properties) walk(items, `${prefix}${key}[*].`);
			else fields.push({ path: `${prefix}${key}[*]`, name: key, type: schemaType(itemType, items.format as string), repeating: true, required });
		} else {
			fields.push({ path: `${prefix}${key}`, name: key, type: schemaType(type, c.format as string), repeating: false, required });
		}
	};
	walk(schema, '');
	if (fields.length === 0) throw new ProfileError('No properties found in the JSON Schema');
	return { kind: 'jsonSchema', fields };
}

function schemaType(type: string | undefined, format?: string): FieldType {
	if (format === 'date' || format === 'date-time' || format === 'time') return 'datetime';
	return dataTypeToField(type);
}

// --- Samples -------------------------------------------------------------------

function parseSampleJson(text: string): Profile {
	const sample = JSON.parse(text);
	const fields: ProfileField[] = [];
	inferFields(Array.isArray(sample) ? sample[0] : sample, '', fields);
	if (fields.length === 0) throw new ProfileError('Could not find any fields in the sample JSON');
	return { kind: 'sampleJson', fields };
}

function parseSampleXml(text: string): Profile {
	const doc = parseXml(text);
	const fields: ProfileField[] = [];
	const sample = elementToSample(doc.root);
	inferFields(sample, '', fields);
	return { kind: 'sampleXml', rootName: localName(doc.root.name), fields: fields.map((f) => ({ ...f, path: stripRoot(f.path, localName(doc.root.name)) })) };
}

function stripRoot(path: string, root: string): string {
	return path === root ? path : path.startsWith(`${root}.`) ? path.slice(root.length + 1) : path;
}

/** Turns an XML element into a plain object using the $/_ convention, like the XML input reader. */
function elementToSample(element: XmlElement): unknown {
	const result: Record<string, unknown> = {};
	if (Object.keys(element.attributes).length > 0) result.$ = { ...element.attributes };
	const kids = childElements(element);
	const text = element.children.filter((c: XmlNode) => c.type === 'text').map((c) => (c as { value: string }).value).join('').trim();
	if (kids.length === 0) {
		if (Object.keys(element.attributes).length === 0) return text;
		if (text !== '') result._ = text;
		return result;
	}
	for (const kid of kids) {
		const name = localName(kid.name);
		const value = elementToSample(kid);
		if (hasOwn(result, name)) {
			const existing = result[name];
			setOwn(result, name, Array.isArray(existing) ? [...existing, value] : [existing, value]);
		} else {
			setOwn(result, name, value);
		}
	}
	if (text !== '') result._ = text;
	return result;
}

function inferFields(value: unknown, prefix: string, fields: ProfileField[], depth = 0): void {
	if (depth > MAX_FIELD_DEPTH) return;
	if (value === null || typeof value !== 'object') {
		fields.push({ path: prefix, name: lastSegment(prefix), type: inferType(value), repeating: false, required: false });
		return;
	}
	if (Array.isArray(value)) {
		const sample = mergeArraySample(value);
		if (sample !== undefined && typeof sample === 'object' && sample !== null && !Array.isArray(sample)) {
			inferFields(sample, `${prefix}[*]`, fields, depth + 1);
		} else {
			fields.push({ path: `${prefix}[*]`, name: lastSegment(prefix), type: inferType(sample), repeating: true, required: false });
		}
		return;
	}
	for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
		inferFields(child, joinKey(prefix, key), fields, depth + 1);
	}
}

/** Merges the keys of every object in an array into one representative sample. */
function mergeArraySample(array: unknown[]): unknown {
	if (array.length === 0) return undefined;
	if (array.some((e) => e === null || typeof e !== 'object' || Array.isArray(e))) return array[0];
	const merged: Record<string, unknown> = {};
	for (const entry of array) {
		for (const [key, value] of Object.entries(entry as Record<string, unknown>)) {
			const current = getOwn(merged, key);
			if (current === null || current === undefined) setOwn(merged, key, value);
		}
	}
	return merged;
}

function inferType(value: unknown): FieldType {
	if (typeof value === 'number') return 'number';
	if (typeof value === 'boolean') return 'boolean';
	if (typeof value === 'string' && DATE_HINT.test(value)) return 'datetime';
	return 'string';
}

function parseCsvHeader(text: string): Profile {
	const firstLine = text.split(/\r?\n/)[0];
	const delimiter = [',', ';', '\t', '|'].map((d) => ({ d, n: firstLine.split(d).length })).sort((a, b) => b.n - a.n)[0].d;
	const columns = firstLine
		.split(delimiter)
		.map((c) => c.trim().replace(/^["']|["']$/g, '').trim())
		.filter((c) => c !== '');
	if (columns.length === 0) throw new ProfileError('No columns found in the CSV header');
	return { kind: 'csv', fields: columns.map((name) => ({ path: name, name, type: 'string', repeating: false, required: false })) };
}

// --- Flattening source data and auto-mapping -----------------------------------

export interface SourcePath {
	path: string;
	name: string;
}

export function flattenSource(data: unknown): SourcePath[] {
	const paths: SourcePath[] = [];
	const walk = (value: unknown, prefix: string, depth: number) => {
		if (depth > MAX_FIELD_DEPTH) return;
		if (value === null || typeof value !== 'object') {
			if (prefix) paths.push({ path: prefix, name: lastSegment(prefix) });
			return;
		}
		if (Array.isArray(value)) {
			const sample = mergeArraySample(value);
			if (sample !== undefined && typeof sample === 'object' && sample !== null && !Array.isArray(sample)) {
				walk(sample, `${prefix}[*]`, depth + 1);
			} else if (prefix) {
				paths.push({ path: `${prefix}[*]`, name: lastSegment(prefix) });
			}
			return;
		}
		for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
			walk(child, joinKey(prefix, key), depth + 1);
		}
	};
	walk(data, '', 0);
	return paths;
}

function lastSegment(path: string): string {
	let tokens: Array<string | number> = [];
	try {
		tokens = parsePath(path);
	} catch {
		return path;
	}
	const names = tokens.filter((t): t is string => typeof t === 'string' && t !== '*' && t !== '$' && t !== '_');
	return names.length ? names[names.length - 1] : path;
}

function normalize(name: string): string {
	return name.toLowerCase().replace(/[^a-z0-9]/g, '');
}

function countStars(path: string): number {
	return (path.match(/\[\*\]/g) ?? []).length;
}

function levenshtein(a: string, b: string): number {
	if (a === b) return 0;
	if (a.length === 0) return b.length;
	if (b.length === 0) return a.length;
	let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
	for (let i = 0; i < a.length; i++) {
		const curr = [i + 1];
		for (let j = 0; j < b.length; j++) {
			curr.push(Math.min(prev[j + 1] + 1, curr[j] + 1, prev[j] + (a[i] === b[j] ? 0 : 1)));
		}
		prev = curr;
	}
	return prev[b.length];
}

function similarity(a: string, b: string): number {
	if (a === '' || b === '') return 0;
	if (a === b) return 1;
	const distance = levenshtein(a, b);
	const ratio = 1 - distance / Math.max(a.length, b.length);
	// Give a boost when one name contains the other (e.g. "id" within "orderid").
	const contains = a.includes(b) || b.includes(a) ? 0.15 : 0;
	return Math.min(1, ratio + contains);
}

export interface AutoMapOptions {
	threshold: number;
	strategy: 'fuzzy' | 'exact';
	caseSensitive: boolean;
	reuseSources: boolean;
	unmatched: 'skip' | 'null';
}

export interface AutoMapResult {
	rules: MappingRule[];
	matched: Array<{ target: string; source: string; confidence: number }>;
	unmatched: string[];
}

const TYPE_TRANSFORM: Record<FieldType, Transform> = {
	string: 'none',
	number: 'number',
	boolean: 'boolean',
	datetime: 'date',
};

export function autoMap(sources: SourcePath[], target: Profile, options: AutoMapOptions): AutoMapResult {
	const matched: AutoMapResult['matched'] = [];
	const unmatched: string[] = [];
	const rules: MappingRule[] = [];
	const used = new Set<string>();

	const prep = (s: string) => (options.caseSensitive ? s : s.toLowerCase());

	for (const field of target.fields) {
		const targetStars = countStars(field.path);
		const targetKey = options.caseSensitive ? field.name : normalize(field.name);
		const targetTokens = field.path.replace(/\[\*\]/g, '').split('.').filter(Boolean).map((t) => (options.caseSensitive ? t : normalize(t)));

		let best: { source: SourcePath; score: number } | undefined;
		for (const source of sources) {
			if (!options.reuseSources && used.has(source.path)) continue;
			if (countStars(source.path) < targetStars) continue; // cannot satisfy a repeating target from a non-repeating source

			const sourceKey = options.caseSensitive ? source.name : normalize(source.name);
			let score = options.caseSensitive ? (sourceKey === targetKey ? 1 : similarity(prep(source.name), prep(field.name))) : similarity(sourceKey, targetKey);

			// Reward when a parent segment also lines up, so order.city beats shipping.city for order.city.
			const sourceTokens = source.path.replace(/\[\*\]/g, '').split('.').filter(Boolean).map((t) => (options.caseSensitive ? t : normalize(t)));
			if (targetTokens.length > 1 && sourceTokens.length > 1) {
				const tParent = targetTokens[targetTokens.length - 2];
				const sParent = sourceTokens[sourceTokens.length - 2];
				if (tParent === sParent) score = Math.min(1, score + 0.1);
			}
			if (options.strategy === 'exact' && score < 1) continue;
			if (!best || score > best.score) best = { source, score };
		}

		if (best && best.score >= options.threshold) {
			used.add(best.source.path);
			matched.push({ target: field.path, source: best.source.path, confidence: Math.round(best.score * 100) / 100 });
			rules.push({ source: best.source.path, target: field.path, transform: TYPE_TRANSFORM[field.type] });
		} else {
			unmatched.push(field.path);
			if (options.unmatched === 'null') rules.push({ source: '\u0000__never__', target: field.path, ifMissing: 'null' });
		}
	}

	return { rules, matched, unmatched };
}

/**
 * Fields of a profile used as the SOURCE. Incoming XML is read with its root element
 * (orders.order...), so a sample-XML profile, which lists fields without the root, gets the
 * root put back in front. Other profile kinds already match the data they describe.
 */
export function sourceFields(profile: Profile): ProfileField[] {
	if (profile.kind !== 'sampleXml' || !profile.rootName) return profile.fields;
	const root = profile.rootName;
	return profile.fields.map((field) => ({ ...field, path: field.path ? `${root}.${field.path}` : root }));
}
