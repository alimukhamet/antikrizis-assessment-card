import ts from 'typescript';import vm from 'node:vm';import {readFile}from'node:fs/promises';import{webcrypto}from'node:crypto';
export const TEST_SECRET='synthetic-assessment-session-secret-123456789';
const source=await readFile(new URL('../lib/worker-session.ts',import.meta.url),'utf8');
const context=vm.createContext({exports:{},URL,crypto:webcrypto,TextEncoder,TextDecoder,btoa,atob,Uint8Array});
vm.runInContext(ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,context);
export const session=context.exports;
export async function testCookie(){return session.SESSION_COOKIE+'='+await session.issueSession('ali',TEST_SECRET)}
