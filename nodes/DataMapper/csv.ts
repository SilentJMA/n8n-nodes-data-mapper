import { parsePath, resolvePath } from './mapping';

export interface CsvColumn {
	/** Mapping path of the column value, e.g. order.id or lines[*].sku */
	path: string;
	/** Header text */
	header: string;
}

export interface CsvOptions {
	delimiter: string;
	header: boolean;
	lineEnding: '\n' | '\r\n';
	/** Prefix cells that start with = + - @ tab or CR with ' so spreadsheets don't run them as formulas. */
	escapeFormulas?: boolean;
}

const FORMULA_START = /^[=+\-@\t\r]/;

function cellText(value: unknown): string {
	if (value === null || value === undefined) return '';
	if (value instanceof Date) return value.toISOString();
	if (typeof value === 'object') return JSON.stringify(value);
	return String(value);
}

function quote(text: string, delimiter: string): string {
	const needsQuotes =
		text.includes(delimiter) || text.includes('"') || text.includes('\n') || text.includes('\r');
	return needsQuotes ? `"${text.replace(/"/g, '""')}"` : text;
}

/**
 * Turns one mapped record into CSV rows. Columns without [*] repeat on every row; columns with
 * [*] give one row per element of the outermost repeating level (like a flat file record per line).
 */
export function recordToRows(record: unknown, columns: CsvColumn[]): string[][] {
	const resolved = columns.map((column) => {
		const tokens = parsePath(column.path);
		const repeating = tokens.includes('*');
		return { repeating, entries: resolvePath(record, tokens) };
	});

	let rowCount = 1;
	for (const column of resolved) {
		if (!column.repeating) continue;
		for (const entry of column.entries) rowCount = Math.max(rowCount, (entry.indices[0] ?? 0) + 1);
	}

	const rows: string[][] = [];
	for (let row = 0; row < rowCount; row++) {
		rows.push(
			resolved.map((column) => {
				if (!column.repeating) return cellText(column.entries[0]?.value);
				const values = column.entries.filter((e) => e.indices[0] === row && e.value !== undefined);
				return values.map((e) => cellText(e.value)).join('|');
			}),
		);
	}
	return rows;
}

export function toCsv(records: unknown[], columns: CsvColumn[], options: CsvOptions): string {
	const lines: string[] = [];
	if (options.header) lines.push(columns.map((c) => quote(c.header, options.delimiter)).join(options.delimiter));
	for (const record of records) {
		for (const row of recordToRows(record, columns)) {
			lines.push(
				row
					.map((cell) => (options.escapeFormulas && FORMULA_START.test(cell) ? `'${cell}` : cell))
					.map((cell) => quote(cell, options.delimiter))
					.join(options.delimiter),
			);
		}
	}
	return lines.join(options.lineEnding) + (lines.length > 0 ? options.lineEnding : '');
}
