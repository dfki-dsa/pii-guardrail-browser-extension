#!/usr/bin/env node

const fs = require('fs');
const ts = require('typescript');

function registerTypeScript() {
  require.extensions['.ts'] = (module, filename) => {
    const source = fs.readFileSync(filename, 'utf8');
    const output = ts.transpileModule(source, {
      fileName: filename,
      compilerOptions: {
        target: ts.ScriptTarget.ES2022,
        module: ts.ModuleKind.CommonJS,
        esModuleInterop: true,
        resolveJsonModule: true,
        skipLibCheck: true,
      },
    }).outputText;

    module._compile(output, filename);
  };
}

async function main() {
  registerTypeScript();
  const {
    benchmarkCliUsage,
    formatBenchmarkDetectionSummary,
    parseBenchmarkCliArgs,
    runBenchmarkDetection,
  } = require('../src/benchmark/detection-harness.ts');

  const options = parseBenchmarkCliArgs(process.argv.slice(2));
  if (options.help) {
    process.stdout.write(`${benchmarkCliUsage()}\n`);
    return;
  }

  const result = await runBenchmarkDetection(options);
  process.stdout.write(`${formatBenchmarkDetectionSummary(result)}\n`);
  if (options.outputPath) {
    process.stdout.write(`Wrote JSON report: ${options.outputPath}\n`);
  }
}

if (require.main === module) {
  main().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
