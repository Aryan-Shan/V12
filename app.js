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
function generateFlowchart(code) {
  try {
    const ast = esprima.parseScript(code, { range: true });
    let flowchart = 'flowchart LR\n'; // Mermaid flowchart (Left to Right)
    let nodeId = 0;
    const edges = [];

    function getNodeId() {
      return `node${nodeId++}`;
    }

    function createNode(text) {
      const id = getNodeId();
      flowchart += `${id}["${text.replace(/"/g, "'")}"]\n`;
      return id;
    }

    function traverse(node, parentId = null) {
      if (!node) return null;

      let currentId = null;

      switch (node.type) {
        case 'Program':
          let lastNode = null;
          for (const stmt of node.body) {
            const nextId = traverse(stmt, lastNode);
            if (lastNode && nextId) edges.push(`${lastNode} --> ${nextId}`);
            lastNode = nextId;
          }
          return lastNode;

        case 'FunctionDeclaration':
          currentId = createNode(`Function: ${node.id.name}`);
          if (parentId) edges.push(`${parentId} --> ${currentId}`);
          traverse(node.body, currentId);
          return currentId;

        case 'BlockStatement':
          let prevBlock = parentId;
          for (const stmt of node.body) {
            const id = traverse(stmt, prevBlock);
            if (prevBlock && id) edges.push(`${prevBlock} --> ${id}`);
            prevBlock = id;
          }
          return prevBlock;

        case 'VariableDeclaration':
          currentId = createNode(
            node.declarations
              .map(d => `${d.id.name} = ${d.init ? code.slice(...d.init.range) : 'undefined'}`)
              .join(', ')
          );
          if (parentId) edges.push(`${parentId} --> ${currentId}`);
          return currentId;

        case 'IfStatement':
          currentId = createNode(`if (${code.slice(...node.test.range)})`);
          if (parentId) edges.push(`${parentId} --> ${currentId}`);
          const consequent = traverse(node.consequent, currentId);
          if (consequent) edges.push(`${currentId} -->|true| ${consequent}`);
          if (node.alternate) {
            const alternate = traverse(node.alternate, currentId);
            if (alternate) edges.push(`${currentId} -->|false| ${alternate}`);
          }
          return currentId;

        case 'WhileStatement':
          currentId = createNode(`while (${code.slice(...node.test.range)})`);
          if (parentId) edges.push(`${parentId} --> ${currentId}`);
          const bodyId = traverse(node.body, currentId);
          if (bodyId) edges.push(`${bodyId} --> ${currentId}`); // loop back
          return currentId;

        case 'ExpressionStatement':
          currentId = createNode(code.slice(...node.range));
          if (parentId) edges.push(`${parentId} --> ${currentId}`);
          return currentId;

        case 'ReturnStatement':
          currentId = createNode(
            `return ${node.argument ? code.slice(...node.argument.range) : ''}`
          );
          if (parentId) edges.push(`${parentId} --> ${currentId}`);
          return currentId;

        default:
          return null;
      }
    }

    traverse(ast);

    // Join edges
    flowchart += edges.join('\n');

    // Inject Mermaid chart into the div
    flowchartDiv.innerHTML = `<div class="mermaid">${flowchart}</div>`;
if (window.mermaid) {
  setTimeout(() => {
    const mermaidDiv = flowchartDiv.querySelector('.mermaid');
    if (mermaidDiv) {
      mermaid.init(undefined, mermaidDiv);
    }
  }, 0);
}

    
  } catch (err) {
    console.error("Flowchart generation error:", err.message);
    flowchartDiv.innerHTML = `<span id="errorMsg">Flowchart Error: ${err.message}</span>`;
  }
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
