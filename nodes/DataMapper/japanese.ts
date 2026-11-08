/** Conversion between hiragana, full-width katakana and half-width katakana. */

export type JapaneseScript = 'hiragana' | 'katakanaFull' | 'katakanaHalf';

const FULL =
	'ァアィイゥウェエォオカガキギクグケゲコゴサザシジスズセゼソゾタダチヂッツヅテデトドナニヌネノハバパヒビピフブプヘベペホボポマミムメモャヤュユョヨラリルレロワヲンヴー・「」、。゛゜';
const HALF = [
	'ｧ',
	'ｱ',
	'ｨ',
	'ｲ',
	'ｩ',
	'ｳ',
	'ｪ',
	'ｴ',
	'ｫ',
	'ｵ',
	'ｶ',
	'ｶﾞ',
	'ｷ',
	'ｷﾞ',
	'ｸ',
	'ｸﾞ',
	'ｹ',
	'ｹﾞ',
	'ｺ',
	'ｺﾞ',
	'ｻ',
	'ｻﾞ',
	'ｼ',
	'ｼﾞ',
	'ｽ',
	'ｽﾞ',
	'ｾ',
	'ｾﾞ',
	'ｿ',
	'ｿﾞ',
	'ﾀ',
	'ﾀﾞ',
	'ﾁ',
	'ﾁﾞ',
	'ｯ',
	'ﾂ',
	'ﾂﾞ',
	'ﾃ',
	'ﾃﾞ',
	'ﾄ',
	'ﾄﾞ',
	'ﾅ',
	'ﾆ',
	'ﾇ',
	'ﾈ',
	'ﾉ',
	'ﾊ',
	'ﾊﾞ',
	'ﾊﾟ',
	'ﾋ',
	'ﾋﾞ',
	'ﾋﾟ',
	'ﾌ',
	'ﾌﾞ',
	'ﾌﾟ',
	'ﾍ',
	'ﾍﾞ',
	'ﾍﾟ',
	'ﾎ',
	'ﾎﾞ',
	'ﾎﾟ',
	'ﾏ',
	'ﾐ',
	'ﾑ',
	'ﾒ',
	'ﾓ',
	'ｬ',
	'ﾔ',
	'ｭ',
	'ﾕ',
	'ｮ',
	'ﾖ',
	'ﾗ',
	'ﾘ',
	'ﾙ',
	'ﾚ',
	'ﾛ',
	'ﾜ',
	'ｦ',
	'ﾝ',
	'ｳﾞ',
	'ｰ',
	'･',
	'｢',
	'｣',
	'､',
	'｡',
	'ﾞ',
	'ﾟ',
];
const FULL_TO_HALF = new Map([...FULL].map((char, i) => [char, HALF[i]]));

const hiraganaToKatakana = (text: string) =>
	text.replace(/[ぁ-ゖゝゞ]/g, (c) => String.fromCharCode(c.charCodeAt(0) + 0x60));

const katakanaToHiragana = (text: string) =>
	text.replace(/[ァ-ヶヽヾ]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0x60));

/** NFKC joins half-width katakana and their voicing marks into full-width katakana. */
const halfToFull = (text: string) => text.replace(/[｡-ﾟ]+/g, (run) => run.normalize('NFKC'));

const fullToHalf = (text: string) =>
	[...text].map((char) => FULL_TO_HALF.get(char) ?? char).join('');

export function convertJapanese(text: string, from: JapaneseScript, to: JapaneseScript): string {
	if (from === to) return text;
	// Go through full-width katakana, which every script converts to and from.
	let full = text;
	if (from === 'hiragana') full = hiraganaToKatakana(text);
	if (from === 'katakanaHalf') full = halfToFull(text);
	if (to === 'katakanaFull') return full;
	if (to === 'hiragana') return katakanaToHiragana(full);
	return fullToHalf(full);
}
