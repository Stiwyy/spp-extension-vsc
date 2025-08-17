const vscode = require('vscode');

/** Hard-coded color map aligned with theme skibidipp.json */
const COLOR_MAP = {
	keyword: '#bb9af7',
	storage: '#bb9af7',
	string: '#9ece6a',
	number: '#ff9e64',
	boolean: '#ff9e64',
	null: '#ff9e64',
	function: '#7aa2f7',
	variable: '#c0caf5',
	operator: '#89ddff',
	console: '#2ac3de',
	builtin: '#f7768e',
	comment: '#565f89',
};

// Build decoration types
const decorations = Object.fromEntries(
	Object.entries(COLOR_MAP).map(([k, color]) => [
		k,
		vscode.window.createTextEditorDecorationType({ color }),
	])
);

// Regex patterns mirroring the TextMate grammar (kept simple; not 100% identical but close)
const REGEX = {
	commentLine: /\/\/.*$/gm,
	commentBlock: /\/\*[\s\S]*?\*\//g,
	string: /"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'/g,
	number: /\b(\d+(?:\.\d+)?(?:e[+-]?\d+)?)\b/gi,
	keyword: /\b(if|else|while|for|return|function|class|new|this)\b/g,
	storage: /\b(const|let|var)\b/g,
	boolean: /\b(true|false)\b/g,
	null: /\bnull\b/g,
	console: /\bconsole\b/g,
	builtin: /\b(print|exit)\b/g,
	operator: /[+\-*\/=><!&|^~%]/g,
	// functions: identifier followed by '(' not preceded by certain keywords
	function: /\b([a-zA-Z_][a-zA-Z0-9_]*)\s*(?=\()/g,
	variable: /\b([a-zA-Z_][a-zA-Z0-9_]*)\b/g,
};

function provideDecorations(editor) {
	if (!editor || editor.document.languageId !== 'skibidipp') return;
	const text = editor.document.getText();

	// First clear existing
	for (const key of Object.keys(decorations)) {
		editor.setDecorations(decorations[key], []);
	}

	// Helper to collect ranges
	const collect = (regex, filterFn) => {
		const ranges = [];
		let m;
		while ((m = regex.exec(text))) {
			if (filterFn && !filterFn(m)) continue;
			const start = editor.document.positionAt(m.index);
			const end = editor.document.positionAt(m.index + m[0].length);
			ranges.push(new vscode.Range(start, end));
			if (regex.lastIndex === m.index) regex.lastIndex++; // avoid zero-length loops
		}
		return ranges;
	};

	// Comments first (so we can later exclude from others if needed)
	const commentLineRanges = collect(REGEX.commentLine);
	const commentBlockRanges = collect(REGEX.commentBlock);
	const commentRanges = [...commentLineRanges, ...commentBlockRanges];
	editor.setDecorations(decorations.comment, commentRanges);

	let occupied = [...commentRanges];
	const isInsideOccupied = (offset) =>
		occupied.some((r) => {
			const start = editor.document.offsetAt(r.start);
			const end = editor.document.offsetAt(r.end);
			return offset >= start && offset < end;
		});

	const apply = (name, regex, predicate) => {
		const ranges = [];
		let m;
		while ((m = regex.exec(text))) {
			if (isInsideOccupied(m.index)) continue;
			if (predicate && !predicate(m)) continue;
			const start = editor.document.positionAt(m.index);
			const end = editor.document.positionAt(m.index + m[0].length);
			ranges.push(new vscode.Range(start, end));
			if (regex.lastIndex === m.index) regex.lastIndex++;
		}
		editor.setDecorations(decorations[name], ranges);
		return ranges;
	};

	const stringRanges = apply('string', new RegExp(REGEX.string));
	occupied = [...occupied, ...stringRanges];

	apply('number', new RegExp(REGEX.number));
	apply('keyword', new RegExp(REGEX.keyword));
	apply('storage', new RegExp(REGEX.storage));
	apply('boolean', new RegExp(REGEX.boolean));
	apply('null', new RegExp(REGEX.null));
	apply('console', new RegExp(REGEX.console));
	apply('builtin', new RegExp(REGEX.builtin));
	apply('operator', new RegExp(REGEX.operator));
	apply('function', new RegExp(REGEX.function), (m) => {
		// m[1] is the identifier portion due to capture group in REGEX.function
		const ident = m[1];
		// Skip built-ins so they are only colored by the 'builtin' decoration (red)
		if (/^(print|exit)$/.test(ident)) return false;
		// Exclude when preceded by certain keywords (to avoid coloring language keywords themselves)
		return !/(if|else|while|for|return|function|class|new|this)$/.test(
			text
				.slice(Math.max(0, m.index - 15), m.index)
				.trimEnd()
				.split(/\s+/)
				.pop() || ''
		);
	});
	// Variables: exclude those already colored as keywords/storage/builtin/function/boolean/null/console
	const seen = new Set();
	const excludeRegex = new RegExp(
		[
			REGEX.keyword,
			REGEX.storage,
			REGEX.boolean,
			REGEX.null,
			REGEX.console,
			REGEX.builtin,
		]
			.map((r) => r.source)
			.join('|')
	); // simplistic
	let vm;
	const variableRegex = new RegExp(REGEX.variable);
	const varRanges = [];
	while ((vm = variableRegex.exec(text))) {
		if (isInsideOccupied(vm.index)) continue;
		if (excludeRegex.test(vm[0])) continue;
		if (/^\d/.test(vm[0])) continue;
		const start = editor.document.positionAt(vm.index);
		const end = editor.document.positionAt(vm.index + vm[0].length);
		const key = vm[0] + ':' + vm.index;
		if (seen.has(key)) continue;
		seen.add(key);
		varRanges.push(new vscode.Range(start, end));
		if (variableRegex.lastIndex === vm.index) variableRegex.lastIndex++;
	}
	editor.setDecorations(decorations.variable, varRanges);
}

function activate(context) {
	const refreshAll = () => {
		const editor = vscode.window.activeTextEditor;
		if (editor) provideDecorations(editor);
	};

	context.subscriptions.push(
		vscode.window.onDidChangeActiveTextEditor(refreshAll)
	);
	context.subscriptions.push(
		vscode.workspace.onDidChangeTextDocument((e) => {
			const editor = vscode.window.activeTextEditor;
			if (editor && e.document === editor.document)
				provideDecorations(editor);
		})
	);
	context.subscriptions.push(
		vscode.workspace.onDidOpenTextDocument((doc) => {
			if (doc.languageId === 'skibidipp') refreshAll();
		})
	);
	refreshAll();
}

function deactivate() {}

module.exports = { activate, deactivate };
