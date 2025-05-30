/*********** CodeMirror setup ***********/
const editor = CodeMirror.fromTextArea(document.getElementById('code'), {
  mode: "javascript",
  lineNumbers: true,
  indentUnit: 2,
  autofocus: true
});
editor.setOption("viewportMargin", Infinity); // allow scrolling beyond visible lines

/*********** DOM refs ***********/
const outputContent = document.getElementById('outputContent');
const flowchartDiv = document.getElementById('flowchartContent');

/*********** Error highlights storage ***********/
let errorMarks = [];

/*********** Highlight error lines in CodeMirror ***********/
function highlightErrorLines(lines) {
  lines.forEach(line => {
    if (line >= 0 && line < editor.lineCount()) {
      const mark = editor.markText(
        { line: line, ch: 0 },
        { line: line, ch: editor.getLine(line).length },
        { className: 'cm-errorLine' }
      );
      errorMarks.push(mark);
    }
  });
}

/*********** Clear previous error highlights ***********/
function clearErrorMarks() {
  errorMarks.forEach(mark => mark.clear());
  errorMarks = [];
}

/*********** Parse error line numbers from error stack or message ***********/
function parseLineNumbersFromError(err) {
  let lines = [];

  if (err.stack) {
    // Match all occurrences like ":<line>:<col>" from stack trace
    const matches = [...err.stack.matchAll(/:(\d+):\d+\)?/g)];
    if (matches.length) {
      matches.forEach(m => {
        const lineNum = parseInt(m[1], 10);
        if (!isNaN(lineNum)) {
          lines.push(lineNum - 1); // Convert 1-based to 0-based
        }
      });
      // Remove duplicates
      lines = [...new Set(lines)];
      return lines;
    }
  }

  // Fallback: check message for line number (e.g. SyntaxError)
  if (err.message) {
    const match = err.message.match(/\((\d+):\d+\)/);
    if (match) {
      const lineNum = parseInt(match[1], 10);
      if (!isNaN(lineNum)) {
        lines.push(lineNum - 1);
        return lines;
      }
    }
  }

  return [];
}

/*********** Run user JS safely and capture output/errors ***********/
function runCode(code) {
  try {
    outputContent.textContent = ''; // Clear previous output
    clearErrorMarks();

    const logs = [];
    const originalLog = console.log;
    console.log = (...args) => {
      logs.push(args.join(' '));
      originalLog.apply(console, args);
    };

    // Execute user code
    new Function(code)();

    console.log = originalLog;

    outputContent.textContent = logs.length ? logs.join('\n') : '(no output)';
  } catch (err) {
    console.log = console.log; // Reset console.log safely
    clearErrorMarks();

    // Show error in red
    outputContent.innerHTML = `<span id="errorMsg">Error: ${err.message}</span>`;

    // Highlight error lines
    const errorLines = parseLineNumbersFromError(err);
    if (errorLines.length > 0) {
      highlightErrorLines(errorLines);
    }
  }
}

/*********** Stub for flowchart generation ***********/
function generateFlowchart() {
  flowchartDiv.textContent = 'Flowchart will be generated here.';
}

/*********** Main pipeline with debounce ***********/
editor.on('change', debounce(handleChange, 200));

function handleChange() {
  const code = editor.getValue();
  runCode(code);
  generateFlowchart(code);
}

/*********** Tiny debounce helper ***********/
function debounce(fn, ms) {
  let t;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn.apply(this, args), ms);
  };
}

// Initial run on page load
handleChange();
