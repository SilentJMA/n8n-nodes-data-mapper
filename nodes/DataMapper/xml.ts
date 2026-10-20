export interface XmlElement {
	type: 'element';
	name: string;
	attributes: Record<string, string>;
	children: XmlNode[];
}

export type XmlNode =
	| XmlElement
	| { type: 'text'; value: string; cdata: boolean }
	| { type: 'comment'; value: string };

export interface XmlDocument {
	declaration?: string;
	root: XmlElement;
}

export interface XmlToJsonOptions {
	attributes: 'group' | 'merge' | 'ignore';
	attributeKey: string;
	textKey: string;
	includeRoot: boolean;
	alwaysArray: boolean;
	trim: boolean;
}

export class XmlParseError extends Error {}

/** Deeper nesting is rejected with a clear error instead of exhausting the stack. */
export const MAX_XML_DEPTH = 1000;

const hasOwn = (container: object, key: string) => Object.prototype.hasOwnProperty.call(container, key);

/** A key named __proto__ becomes a plain property instead of changing the object's prototype. */
function setOwn(container: Record<string, unknown>, key: string, value: unknown): void {
	if (key === '__proto__') {
		Object.defineProperty(container, key, { value, enumerable: true, writable: true, configurable: true });
	} else {
		container[key] = value;
	}
}

const ENTITIES: Record<string, string> = { lt: '<', gt: '>', amp: '&', quot: '"', apos: "'" };

function decodeEntities(text: string): string {
	return text.replace(/&(#x[0-9a-fA-F]+|#\d+|[a-zA-Z]+);/g, (match, ref: string) => {
		if (ref[0] === '#') {
			const code = ref[1] === 'x' ? parseInt(ref.slice(2), 16) : parseInt(ref.slice(1), 10);
			return Number.isNaN(code) ? match : String.fromCodePoint(code);
		}
		return ENTITIES[ref] ?? match;
	});
}

export function parseXml(input: string): XmlDocument {
	let pos = 0;
	let declaration: string | undefined;
	let root: XmlElement | undefined;

	const fail = (message: string, at = pos): never => {
		const before = input.slice(0, at).split('\n');
		throw new XmlParseError(`${message} (line ${before.length}, column ${before[before.length - 1].length + 1})`);
	};

	const startsWith = (s: string) => input.startsWith(s, pos);

	const readUntil = (end: string, what: string): string => {
		const idx = input.indexOf(end, pos);
		if (idx === -1) fail(`Unclosed ${what}`);
		const value = input.slice(pos, idx);
		pos = idx + end.length;
		return value;
	};

	const skipWhitespace = () => {
		while (pos < input.length && /\s/.test(input[pos])) pos++;
	};

	const readName = (): string => {
		const match = /^[^\s/>=<"']+/.exec(input.slice(pos, pos + 1000));
		if (!match) fail('Expected a tag or attribute name');
		pos += match![0].length;
		return match![0];
	};

	const skipDoctype = () => {
		let depth = 0;
		for (; pos < input.length; pos++) {
			if (input[pos] === '[') depth++;
			else if (input[pos] === ']') depth--;
			else if (input[pos] === '>' && depth === 0) {
				pos++;
				return;
			}
		}
		fail('Unclosed DOCTYPE');
	};

	const parseElement = (depth: number): XmlElement => {
		if (depth > MAX_XML_DEPTH) fail(`XML is nested more than ${MAX_XML_DEPTH} levels deep`);
		const start = pos;
		pos++; // <
		const name = readName();
		const element: XmlElement = { type: 'element', name, attributes: {}, children: [] };

		for (;;) {
			skipWhitespace();
			if (startsWith('/>')) {
				pos += 2;
				return element;
			}
			if (startsWith('>')) {
				pos++;
				break;
			}
			if (pos >= input.length) fail(`Unclosed tag <${name}>`, start);
			const attrName = readName();
			skipWhitespace();
			if (input[pos] !== '=') fail(`Expected "=" after attribute "${attrName}"`);
			pos++;
			skipWhitespace();
			const quote = input[pos];
			if (quote !== '"' && quote !== "'") fail(`Attribute "${attrName}" value must be quoted`);
			pos++;
			if (hasOwn(element.attributes, attrName)) fail(`Duplicate attribute "${attrName}"`);
			setOwn(element.attributes, attrName, decodeEntities(readUntil(quote, `attribute "${attrName}"`)));
		}

		for (;;) {
			if (pos >= input.length) fail(`Missing closing tag </${name}>`, start);
			if (startsWith('</')) {
				const closeAt = pos;
				pos += 2;
				const closeName = readName();
				skipWhitespace();
				if (input[pos] !== '>') fail(`Expected ">" to close </${closeName}`);
				pos++;
				if (closeName !== name) fail(`Expected </${name}> but found </${closeName}>`, closeAt);
				return element;
			}
			if (startsWith('<!--')) {
				pos += 4;
				element.children.push({ type: 'comment', value: readUntil('-->', 'comment') });
			} else if (startsWith('<![CDATA[')) {
				pos += 9;
				element.children.push({ type: 'text', value: readUntil(']]>', 'CDATA section'), cdata: true });
			} else if (startsWith('<?')) {
				pos += 2;
				readUntil('?>', 'processing instruction');
			} else if (startsWith('<')) {
				element.children.push(parseElement(depth + 1));
			} else {
				const next = input.indexOf('<', pos);
				const end = next === -1 ? input.length : next;
				element.children.push({ type: 'text', value: decodeEntities(input.slice(pos, end)), cdata: false });
				pos = end;
			}
		}
	};

	if (input.charCodeAt(0) === 0xfeff) pos = 1;

	while (pos < input.length) {
		skipWhitespace();
		if (pos >= input.length) break;
		if (startsWith('<?')) {
			const start = pos;
			pos += 2;
			readUntil('?>', 'processing instruction');
			const pi = input.slice(start, pos);
			if (!root && /^<\?xml\s/.test(pi)) declaration = pi;
		} else if (startsWith('<!--')) {
			pos += 4;
			readUntil('-->', 'comment');
		} else if (startsWith('<!DOCTYPE') || startsWith('<!doctype')) {
			skipDoctype();
		} else if (startsWith('<')) {
			if (root) fail('Only one root element is allowed');
			root = parseElement(1);
		} else {
			fail('Text is not allowed outside the root element');
		}
	}

	if (!root) throw new XmlParseError('No XML element found');
	return { declaration, root };
}

function elementToJson(element: XmlElement, options: XmlToJsonOptions): unknown {
	const childElements = element.children.filter((c): c is XmlElement => c.type === 'element');
	let text = element.children
		.map((c) => (c.type === 'text' ? c.value : ''))
		.join('');
	if (options.trim) text = text.trim();
	else if (childElements.length > 0 && text.trim() === '') text = '';

	const attributeNames = options.attributes === 'ignore' ? [] : Object.keys(element.attributes);

	if (attributeNames.length === 0 && childElements.length === 0) return text;

	const result: Record<string, unknown> = {};
	const add = (key: string, value: unknown) => {
		if (options.alwaysArray) {
			const existing = hasOwn(result, key) ? (result[key] as unknown[]) : [];
			setOwn(result, key, [...existing, value]);
		} else if (hasOwn(result, key)) {
			const existing = result[key];
			setOwn(result, key, Array.isArray(existing) ? [...existing, value] : [existing, value]);
		} else {
			setOwn(result, key, value);
		}
	};

	if (attributeNames.length > 0) {
		if (options.attributes === 'merge') {
			for (const name of attributeNames) add(name, element.attributes[name]);
		} else {
			setOwn(result, options.attributeKey, { ...element.attributes });
		}
	}
	for (const child of childElements) add(child.name, elementToJson(child, options));
	if (text !== '') setOwn(result, options.textKey, text);

	return result;
}

export function xmlToJson(document: XmlDocument, options: XmlToJsonOptions): Record<string, unknown> {
	const value = elementToJson(document.root, options);
	if (options.includeRoot || value === null || typeof value !== 'object') {
		return { [document.root.name]: options.alwaysArray ? [value] : value };
	}
	return value as Record<string, unknown>;
}

function escapeText(value: string): string {
	return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function escapeAttribute(value: string): string {
	return escapeText(value).replace(/"/g, '&quot;');
}

function formatNode(node: XmlNode, indent: string, depth: number): string[] {
	const pad = indent.repeat(depth);
	if (node.type === 'comment') return [`${pad}<!--${node.value}-->`];
	if (node.type === 'text') {
		const value = node.cdata ? `<![CDATA[${node.value}]]>` : escapeText(node.value.trim());
		return value === '' ? [] : [pad + value];
	}

	const attrs = Object.entries(node.attributes)
		.map(([k, v]) => ` ${k}="${escapeAttribute(v)}"`)
		.join('');
	const meaningful = node.children.filter(
		(c) => !(c.type === 'text' && !c.cdata && c.value.trim() === ''),
	);

	if (meaningful.length === 0) return [`${pad}<${node.name}${attrs}/>`];
	if (meaningful.every((c) => c.type === 'text')) {
		const inner = meaningful
			.map((c) => (c.type === 'text' && c.cdata ? `<![CDATA[${c.value}]]>` : escapeText((c as { value: string }).value)))
			.join('');
		return [`${pad}<${node.name}${attrs}>${inner}</${node.name}>`];
	}
	return [
		`${pad}<${node.name}${attrs}>`,
		...meaningful.flatMap((c) => formatNode(c, indent, depth + 1)),
		`${pad}</${node.name}>`,
	];
}

export function formatXml(document: XmlDocument, indent = '  '): string {
	const lines = formatNode(document.root, indent, 0);
	if (document.declaration) lines.unshift(document.declaration);
	return lines.join('\n');
}

export interface JsonToXmlOptions {
	rootName?: string;
	declaration: boolean;
	attributeKey: string;
	textKey: string;
}

const XML_NAME = /^[A-Za-z_][\w.:-]*$/;

function assertName(name: string): string {
	if (!XML_NAME.test(name)) {
		throw new XmlParseError(
			`"${name}" is not a valid XML element name. Names must start with a letter or underscore and contain no spaces.`,
		);
	}
	return name;
}

function scalarToText(value: unknown): string {
	if (value === null || value === undefined) return '';
	if (value instanceof Date) return value.toISOString();
	return String(value);
}

function buildElement(name: string, value: unknown, options: JsonToXmlOptions): XmlElement {
	const element: XmlElement = { type: 'element', name: assertName(name), attributes: {}, children: [] };
	if (value === null || typeof value !== 'object' || value instanceof Date) {
		const text = scalarToText(value);
		if (text !== '') element.children.push({ type: 'text', value: text, cdata: false });
		return element;
	}
	if (Array.isArray(value)) {
		throw new XmlParseError(`Cannot put an array directly inside <${name}>; give the array a field name`);
	}
	for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
		if (key === options.attributeKey && child && typeof child === 'object' && !Array.isArray(child)) {
			for (const [attr, attrValue] of Object.entries(child as Record<string, unknown>)) {
				setOwn(element.attributes, assertName(attr), scalarToText(attrValue));
			}
		} else if (key === options.textKey) {
			const text = scalarToText(child);
			if (text !== '') element.children.push({ type: 'text', value: text, cdata: false });
		} else if (Array.isArray(child)) {
			for (const entry of child) element.children.push(buildElement(key, entry, options));
		} else if (child !== undefined) {
			element.children.push(buildElement(key, child, options));
		}
	}
	return element;
}

/**
 * Builds XML from data in the same shape `xmlToJson` produces: attributes under the attribute
 * key, text under the text key, arrays as repeated elements. Without a root name, a single
 * top-level field becomes the root element; otherwise everything is wrapped in <root>.
 */
export function jsonToXml(data: Record<string, unknown>, options: JsonToXmlOptions): string {
	const keys = Object.keys(data);
	let root: XmlElement;
	if (options.rootName) {
		root = buildElement(options.rootName, data, options);
	} else if (keys.length === 1 && !Array.isArray(data[keys[0]]) && keys[0] !== options.attributeKey && keys[0] !== options.textKey) {
		root = buildElement(keys[0], data[keys[0]], options);
	} else {
		root = buildElement('root', data, options);
	}
	return formatXml({
		declaration: options.declaration ? '<?xml version="1.0" encoding="UTF-8"?>' : undefined,
		root,
	});
}
