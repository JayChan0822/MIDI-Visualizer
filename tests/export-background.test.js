const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');

function extractFunctionSource(source, functionName) {
  const signature = `function ${functionName}`;
  const start = source.indexOf(signature);

  if (start === -1) {
    throw new Error(`Function ${functionName} not found in index.html`);
  }

  const braceStart = source.indexOf('{', start);
  if (braceStart === -1) {
    throw new Error(`Function ${functionName} has no body`);
  }

  let depth = 0;
  for (let i = braceStart; i < source.length; i += 1) {
    const char = source[i];
    if (char === '{') depth += 1;
    if (char === '}') {
      depth -= 1;
      if (depth === 0) {
        return source.slice(start, i + 1);
      }
    }
  }

  throw new Error(`Function ${functionName} body is not balanced`);
}

function loadFunctions(functionNames, contextExtras = {}) {
  const context = {
    module: { exports: null },
    exports: {},
    ...contextExtras,
  };

  vm.createContext(context);
  const sources = functionNames.map((functionName) => extractFunctionSource(html, functionName));
  vm.runInContext(`${sources.join('\n')}; module.exports = { ${functionNames.join(', ')} };`, context);
  return context.module.exports;
}

function normalize(value) {
  return JSON.parse(JSON.stringify(value));
}

test('white theme export uses opaque white canvas clear color', () => {
  const { resolveExportCanvasClear } = loadFunctions(['getCurrentThemeMode', 'resolveExportCanvasClear'], {
    localStorage: {
      getItem(key) {
        return key === 'mv_bg_theme_mode' ? 'white' : null;
      }
    }
  });

  const result = resolveExportCanvasClear(false);

  assert.deepEqual(normalize(result), { color: 0xffffff, alpha: 1 });
});

test('dark theme export keeps opaque black canvas clear color', () => {
  const { resolveExportCanvasClear } = loadFunctions(['getCurrentThemeMode', 'resolveExportCanvasClear'], {
    localStorage: {
      getItem() {
        return 'dark';
      }
    }
  });

  const result = resolveExportCanvasClear(false);

  assert.deepEqual(normalize(result), { color: 0x000000, alpha: 1 });
});

test('custom imported background keeps transparent clear color during export', () => {
  const { resolveExportCanvasClear } = loadFunctions(['getCurrentThemeMode', 'resolveExportCanvasClear'], {
    localStorage: {
      getItem() {
        return 'white';
      }
    }
  });

  const result = resolveExportCanvasClear(true);

  assert.deepEqual(normalize(result), { color: 0x000000, alpha: 0 });
});
