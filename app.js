/*********** CodeMirror setup ***********/
const editor = CodeMirror.fromTextArea(document.getElementById("code"), {
  mode: "javascript",
  lineNumbers: true,
  indentUnit: 2,
  autofocus: true,
});
editor.setOption("viewportMargin", Infinity); // allow scrolling beyond visible lines

/*********** DOM refs ***********/
const outputContent = document.getElementById("outputContent");
const flowchartDiv = document.getElementById("flowchartContent");
const flowchartWrapper = document.getElementById("flowchart-wrapper"); // assumes you wrap it

/*********** Error highlights storage ***********/
let errorMarks = [];

/*********** Highlight error lines in CodeMirror ***********/
function highlightErrorLines(lines) {
  lines.forEach((line) => {
    if (line >= 0 && line < editor.lineCount()) {
      const mark = editor.markText(
        { line: line, ch: 0 },
        { line: line, ch: editor.getLine(line).length },
        { className: "cm-errorLine" }
      );
      errorMarks.push(mark);
    }
  });
}

/*********** Clear previous error highlights ***********/
function clearErrorMarks() {
  errorMarks.forEach((mark) => mark.clear());
  errorMarks = [];
}

/*********** Parse error line numbers from error stack or message ***********/
function parseLineNumbersFromError(err) {
  let lines = [];
  if (err.stack) {
    const matches = [...err.stack.matchAll(/:(\d+):\d+\)?/g)];
    if (matches.length) {
      matches.forEach((m) => {
        const lineNum = parseInt(m[1], 10);
        if (!isNaN(lineNum)) {
          lines.push(lineNum - 1);
        }
      });
      return [...new Set(lines)];
    }
  }
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
    outputContent.textContent = "";
    clearErrorMarks();
    const logs = [];
    const originalLog = console.log;
    console.log = (...args) => {
      logs.push(args.join(" "));
      originalLog.apply(console, args);
    };
    new Function(code)();
    console.log = originalLog;
    outputContent.textContent = logs.length ? logs.join("\n") : "(no output)";
  } catch (err) {
    console.log = console.log;
    clearErrorMarks();
    outputContent.innerHTML = `<span id="errorMsg">Error: ${err.message}</span>`;
    const errorLines = parseLineNumbersFromError(err);
    if (errorLines.length > 0) highlightErrorLines(errorLines);
  }
}

/*********** Flowchart generation ***********/
function generateFlowchart(code) {
  try {
    const ast = esprima.parseScript(code, { range: true });
    let flowchart = "flowchart LR\n";
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
        case "Program": {
          let lastNode = null;
          for (const stmt of node.body) {
            lastNode = traverse(stmt, lastNode);
          }
          return lastNode;
        }
        case "FunctionDeclaration": {
          currentId = createNode(`Function: ${node.id.name}`);
          if (parentId) edges.push(`${parentId} --> ${currentId}`);
          traverse(node.body, currentId);
          return currentId;
        }
        case "BlockStatement": {
          let prev = parentId;
          for (const stmt of node.body) {
            prev = traverse(stmt, prev);
          }
          return prev;
        }
        case "VariableDeclaration": {
          currentId = createNode(
            node.declarations
              .map((d) => `${d.id.name} = ${d.init ? code.slice(...d.init.range) : "undefined"}`)
              .join(", ")
          );
          if (parentId) edges.push(`${parentId} --> ${currentId}`);
          return currentId;
        }
        case "IfStatement": {
          currentId = createNode(`if (${code.slice(...node.test.range)})`);
          if (parentId) edges.push(`${parentId} --> ${currentId}`);

          const consequentId = traverse(node.consequent, currentId);
          if (consequentId) edges.push(`${currentId} -->|true| ${consequentId}`);

          if (node.alternate) {
            const alternateId = traverse(node.alternate, currentId);
            if (alternateId) edges.push(`${currentId} -->|false| ${alternateId}`);
          }

          return currentId;
        }
        case "WhileStatement": {
          currentId = createNode(`while (${code.slice(...node.test.range)})`);
          if (parentId) edges.push(`${parentId} --> ${currentId}`);

          const bodyId = traverse(node.body, currentId);
          if (bodyId) edges.push(`${bodyId} --> ${currentId}`);

          return currentId;
        }
        case "ExpressionStatement": {
          currentId = createNode(code.slice(...node.range));
          if (parentId) edges.push(`${parentId} --> ${currentId}`);
          return currentId;
        }
        case "ReturnStatement": {
          currentId = createNode(
            `return ${node.argument ? code.slice(...node.argument.range) : ""}`
          );
          if (parentId) edges.push(`${parentId} --> ${currentId}`);
          return currentId;
        }
        default:
          return null;
      }
    }

    traverse(ast);

    flowchart += [...new Set(edges)].join("\n");

    flowchartDiv.innerHTML = `<div class="mermaid">${flowchart}</div>`;

    // Mermaid v10+ rendering
    if (window.mermaid && window.mermaid.run) {
      setTimeout(() => {
        window.mermaid.run({ nodes: [flowchartDiv.querySelector(".mermaid")] });
      }, 0);
    } else if (window.mermaid && window.mermaid.init) {
      setTimeout(() => {
        window.mermaid.init(undefined, flowchartDiv.querySelectorAll(".mermaid"));
      }, 0);
    }
  } catch (err) {
    console.error("Flowchart generation error:", err.message);
    flowchartDiv.innerHTML = `<span id="errorMsg">Flowchart Error: ${err.message}</span>`;
  }
}

/*********** Zoom & pan flowchart ***********/
let scale = 1;
let x = 0, y = 0;
let isDragging = false;
let startX, startY;

flowchartWrapper.addEventListener('wheel', (e) => {
  e.preventDefault();
  const delta = -e.deltaY * 0.001;
  scale += delta;
  scale = Math.min(Math.max(0.1, scale), 3);
  updateTransform();
});

flowchartWrapper.addEventListener('mousedown', (e) => {
  isDragging = true;
  startX = e.clientX - x;
  startY = e.clientY - y;
});

flowchartWrapper.addEventListener('mousemove', (e) => {
  if (!isDragging) return;
  x = e.clientX - startX;
  y = e.clientY - startY;
  updateTransform();
});

flowchartWrapper.addEventListener('mouseup', () => isDragging = false);
flowchartWrapper.addEventListener('mouseleave', () => isDragging = false);

function updateTransform() {
  flowchartDiv.style.transform = `translate(${x}px, ${y}px) scale(${scale})`;
}

/*********** Main pipeline with debounce ***********/
editor.on("change", debounce(handleChange, 200));

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

document.getElementById("downloadFlowchart").addEventListener("click", () => {
  const flowchartEl = document.getElementById("flowchartContent");

  // Reset transform temporarily to capture correctly
  const originalTransform = flowchartEl.style.transform;
  flowchartEl.style.transform = "none";

  html2canvas(flowchartEl, { backgroundColor: "#ffffff" }).then(canvas => {
    // Restore original transform
    flowchartEl.style.transform = originalTransform;

    const link = document.createElement("a");
    link.download = "flowchart.jpg";
    link.href = canvas.toDataURL("image/jpeg", 1.0);
    link.click();
  });
});

/*********** Theme toggle ***********/
const themeToggle = document.getElementById("themeToggle");
const prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
const savedTheme = localStorage.getItem("theme");

function setTheme(dark) {
  document.body.classList.toggle("dark", dark);
  localStorage.setItem("theme", dark ? "dark" : "light");
  editor.setOption("theme", dark ? "base16-dark" : "default");
}

// Load theme on page load
setTheme(savedTheme === "dark" || (savedTheme === null && prefersDark));

// Toggle on button click
themeToggle.addEventListener("click", () => {
  setTheme(!document.body.classList.contains("dark"));
});

// --- Lessons Section Logic ---
const lessons = {
  variables: {
    title: "Variables",
    description: `Variables store data values. In JavaScript, use <code>let</code> or <code>const</code> to declare variables.`,
    example: `let name = "Alice";
let age = 25;
console.log("Name:", name);
console.log("Age:", age);`
  },
  loops: {
    title: "Loops",
    description: `Loops let you repeat code. The <code>for</code> loop is common for counting.`,
    example: `for (let i = 1; i <= 5; i++) {
  console.log("Count:", i);
}`
  },
  functions: {
    title: "Functions",
    description: `Functions group code to run it multiple times. Use <code>function</code> to define one.`,
    example: `function greet(name) {
  console.log("Hello, " + name + "!");
}
greet("Alice");
greet("Bob");`
  },
  conditionals: {
    title: "Conditionals",
    description: `Conditionals let you run code only if something is true. Use <code>if</code> and <code>else</code>.`,
    example: `let score = 85;
if (score >= 60) {
  console.log("Passed!");
} else {
  console.log("Try again!");
}`
  }
};

const lessonsLink = document.getElementById("lessonsLink");
const lessonsSection = document.getElementById("lessonsSection");
const container = document.getElementById("container");
const lessonContent = document.getElementById("lessonContent");
const backToEditor = document.getElementById("backToEditor");

if (lessonsLink) {
  lessonsLink.addEventListener("click", (e) => {
    e.preventDefault();
    container.style.display = "none";
    lessonsSection.style.display = "block";
    lessonContent.innerHTML = "<p>Select a topic to begin.</p>";
  });
}

if (backToEditor) {
  backToEditor.addEventListener("click", () => {
    lessonsSection.style.display = "none";
    container.style.display = "";
  });
}

document.querySelectorAll(".lesson-btn").forEach(btn => {
  btn.addEventListener("click", () => {
    const lesson = lessons[btn.dataset.lesson];
    if (lesson) {
      lessonContent.innerHTML = `
        <h3>${lesson.title}</h3>
        <p>${lesson.description}</p>
        <pre style="background:#222;color:#fff;padding:10px;border-radius:6px;"><code>${lesson.example}</code></pre>
        <button class="nav-link" id="tryLessonCode" style="margin-top:1em;">Try in Editor</button>
      `;
      // Add event for "Try in Editor"
      setTimeout(() => {
        const tryBtn = document.getElementById("tryLessonCode");
        if (tryBtn) {
          tryBtn.onclick = () => {
            lessonsSection.style.display = "none";
            container.style.display = "";
            editor.setValue(lesson.example);
            editor.focus();
          };
        }
      }, 0);
    }
  });
});
