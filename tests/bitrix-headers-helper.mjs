import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
// Exercise the real production header builder in isolated adapter test modules.
const exports = {};
vm.runInNewContext(ts.transpileModule(fs.readFileSync(new URL('../lib/crm/http-headers.ts', import.meta.url), 'utf8'), {compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText, {exports,URL});
export const httpHeaders = exports;
