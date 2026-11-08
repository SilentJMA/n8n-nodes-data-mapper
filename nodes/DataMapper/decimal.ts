/** Exact decimal arithmetic for the Numeric functions: 0.1 + 0.2 is 0.3. */

export class DecimalError extends Error {}

interface Dec {
	/** Unscaled value: the number is units / 10^scale. */
	units: bigint;
	scale: number;
}

const DECIMAL = /^([+-]?)(\d*)(?:\.(\d*))?(?:[eE]([+-]?\d+))?$/;

export function parseDecimal(value: unknown): Dec {
	const text = typeof value === 'number' ? numberText(value) : String(value ?? '').trim();
	const match = DECIMAL.exec(text);
	if (!match || (match[2] === '' && (match[3] ?? '') === '')) {
		throw new DecimalError(`"${String(value)}" is not a number`);
	}
	const [, sign, whole, fraction = '', exponent] = match;
	let units = BigInt(`${whole || '0'}${fraction}` || '0');
	let scale = fraction.length - Number(exponent ?? 0);
	if (scale < 0) {
		units *= BigInt(10) ** BigInt(-scale);
		scale = 0;
	}
	return { units: sign === '-' ? -units : units, scale };
}

function numberText(value: number): string {
	if (!Number.isFinite(value)) throw new DecimalError(`"${value}" is not a number`);
	return String(value);
}

function align(a: Dec, b: Dec): [bigint, bigint, number] {
	const scale = Math.max(a.scale, b.scale);
	return [
		a.units * BigInt(10) ** BigInt(scale - a.scale),
		b.units * BigInt(10) ** BigInt(scale - b.scale),
		scale,
	];
}

const abs = (n: bigint) => (n < BigInt(0) ? -n : n);

/** Divides and rounds half away from zero. */
function divRound(numerator: bigint, denominator: bigint): bigint {
	const quotient = numerator / denominator;
	const remainder = numerator % denominator;
	if (abs(remainder) * BigInt(2) >= abs(denominator)) {
		return quotient + (numerator < BigInt(0) !== denominator < BigInt(0) ? -BigInt(1) : BigInt(1));
	}
	return quotient;
}

export function toText(d: Dec): string {
	const negative = d.units < BigInt(0);
	let digits = abs(d.units).toString();
	if (d.scale === 0) return `${negative ? '-' : ''}${digits}`;
	digits = digits.padStart(d.scale + 1, '0');
	const text = `${digits.slice(0, -d.scale)}.${digits.slice(-d.scale)}`;
	return `${negative ? '-' : ''}${text}`;
}

function stripZeros(d: Dec): Dec {
	let { units, scale } = d;
	while (scale > 0 && units % BigInt(10) === BigInt(0)) {
		units /= BigInt(10);
		scale--;
	}
	return { units, scale };
}

export const add = (a: Dec, b: Dec): Dec => {
	const [x, y, scale] = align(a, b);
	return { units: x + y, scale };
};

export const subtract = (a: Dec, b: Dec): Dec => {
	const [x, y, scale] = align(a, b);
	return { units: x - y, scale };
};

export const multiply = (a: Dec, b: Dec): Dec => ({
	units: a.units * b.units,
	scale: a.scale + b.scale,
});

/** Quotient with 10 decimal places, half up; trailing zeros removed. */
export function divide(a: Dec, b: Dec): Dec {
	if (b.units === BigInt(0)) throw new DecimalError('Division by zero');
	const scale = 10;
	// a/b = (a.units/10^a.scale) / (b.units/10^b.scale)
	const numerator = a.units * BigInt(10) ** BigInt(scale + b.scale);
	const denominator = b.units * BigInt(10) ** BigInt(a.scale);
	return stripZeros({ units: divRound(numerator, denominator), scale });
}

/** Rounds half up to `places` decimals, padding with zeros. */
export function setPrecision(a: Dec, places: number): Dec {
	if (!Number.isInteger(places) || places < 0) {
		throw new DecimalError(`Precision "${places}" must be a whole number`);
	}
	if (places >= a.scale) {
		return { units: a.units * BigInt(10) ** BigInt(places - a.scale), scale: places };
	}
	return { units: divRound(a.units, BigInt(10) ** BigInt(a.scale - places)), scale: places };
}

export function ceil(a: Dec): Dec {
	const factor = BigInt(10) ** BigInt(a.scale);
	let q = a.units / factor;
	if (a.units % factor !== BigInt(0) && a.units > BigInt(0)) q += BigInt(1);
	return { units: q, scale: 0 };
}

export function floor(a: Dec): Dec {
	const factor = BigInt(10) ** BigInt(a.scale);
	let q = a.units / factor;
	if (a.units % factor !== BigInt(0) && a.units < BigInt(0)) q -= BigInt(1);
	return { units: q, scale: 0 };
}

export const absolute = (a: Dec): Dec => ({ units: abs(a.units), scale: a.scale });

/**
 * Formats with a number mask: `#` optional digit, `0` required digit, `,` grouping, `.` decimal point.
 * Text before and after the digits is kept, for example `$#,##0.00`.
 */
export function formatWithMask(a: Dec, mask: string): string {
	const match = /^([^#0,.]*)([#0,]*)(?:\.([#0]*))?(.*)$/.exec(mask);
	if (!match || mask.trim() === '') throw new DecimalError(`Number mask "${mask}" is not valid`);
	const [, prefix, integerMask, fractionMask = '', suffix] = match;
	const minFraction = (fractionMask.match(/0/g) ?? []).length;
	const maxFraction = fractionMask.length;
	const minInteger = (integerMask.match(/0/g) ?? []).length;
	const lastComma = integerMask.lastIndexOf(',');
	const grouping = lastComma === -1 ? 0 : integerMask.length - lastComma - 1;

	const rounded = setPrecision(a, maxFraction);
	const negative = rounded.units < BigInt(0);
	const text = toText(absolute(rounded));
	let [whole, fraction = ''] = text.split('.');
	while (fraction.length > minFraction && fraction.endsWith('0')) fraction = fraction.slice(0, -1);
	whole = whole.replace(/^0+(?=\d)/, '');
	if (whole === '0' && minInteger === 0) whole = '';
	whole = whole.padStart(minInteger, '0');
	if (grouping > 0) whole = group(whole, grouping);
	const body = fraction ? `${whole}.${fraction}` : whole || '0';
	return `${negative ? '-' : ''}${prefix}${body}${suffix}`;
}

function group(digits: string, size: number): string {
	const parts: string[] = [];
	for (let end = digits.length; end > 0; end -= size) {
		parts.unshift(digits.slice(Math.max(0, end - size), end));
	}
	return parts.join(',');
}

/** Reads a number formatted with a mask: grouping commas and text around the digits are ignored. */
export function parseWithMask(value: unknown, mask: string): Dec {
	const text = String(value ?? '').trim();
	const prefix = /^[^#0,.]*/.exec(mask)?.[0] ?? '';
	const suffix = /[^#0,.]*$/.exec(mask)?.[0] ?? '';
	let body = text;
	if (prefix && body.startsWith(prefix)) body = body.slice(prefix.length);
	if (suffix && body.endsWith(suffix)) body = body.slice(0, -suffix.length);
	return parseDecimal(body.replace(/,/g, ''));
}

/** A JS number when it keeps every digit, else the exact text (for example 8.6000). */
export function toResult(d: Dec): number | string {
	const text = toText(d);
	const num = Number(text);
	return String(num) === text ? num : text;
}
