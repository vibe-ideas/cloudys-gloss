import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { mkdir, readFile, writeFile, readdir } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import manifest from '../data/ocr-models.json';

/** Emscripten bindings expressed as static closures. Keep MV3's JavaScript eval ban. */
export function extensionSafeOcrWorker(source: string) {
  const end = 'attachWorkerMessageHandler(createPaddleOCRWorkerMessageHandler());';
  const boundary = source.indexOf(end);
  if (boundary < 0 || !source.includes('ONNX Runtime Web v1.24.3')) throw new Error('OCR SDK bundle changed; review the worker adapter');
  let result = source.slice(0, boundary + end.length);
  const named = /function createNamedFunction\(name, body\) \{[\s\S]*?\n {10}\}/;
  const dyn = /function makeDynCaller\(dynCall\) \{[\s\S]*?\n {12}\}/;
  const ort = /ortModulePromise = Promise\.resolve\(\)\.then\(function\(\) \{\s*return ort_bundle_min;\s*\}\);/;
  const invoke = /function craftInvokerFunction\(humanName, argTypes, classType, cppInvokerFunc, cppTargetFunc\) \{[\s\S]*?\n {10}\}/;
  const method = /function __emval_get_method_caller\(argCount, argTypes\) \{[\s\S]*?\n {10}\}/;
  for (const pattern of [named, dyn, ort, invoke, method]) if ((result.match(new RegExp(pattern.source, 'g')) ?? []).length !== 1) throw new Error('OCR SDK adapter no longer matches');
  result = result.replace(named, 'function createNamedFunction(name, body) { const wrapper = function(...args) { return body.apply(this, args); }; Object.defineProperty(wrapper, "name", { value: makeLegalFunctionName(name) }); return wrapper; }')
    .replace(dyn, 'function makeDynCaller(dynCall) { return function(...args) { return dynCall(rawFunction, ...args); }; }')
    .replace(ort, 'ortModulePromise = import("./ort.wasm.min.mjs");')
    .replace(invoke, `function craftInvokerFunction(humanName, argTypes, classType, cppInvokerFunc, cppTargetFunc) {
      const isMethod = argTypes[1] !== null && classType !== null;
      const needsStack = argTypes.slice(1).some(type => type !== null && type.destructorFunction === undefined);
      return function(...args) {
        if (args.length !== argTypes.length - 2) throwBindingError('Invalid argument count for ' + humanName);
        const destructors = needsStack ? [] : null;
        const wired = [];
        if (isMethod) wired.push(argTypes[1].toWireType(destructors, this));
        args.forEach((arg, index) => wired.push(argTypes[index + 2].toWireType(destructors, arg)));
        const value = cppInvokerFunc(cppTargetFunc, ...wired);
        if (needsStack) runDestructors(destructors);
        else for (let index = isMethod ? 1 : 2; index < argTypes.length; index++) {
          if (argTypes[index].destructorFunction !== null) argTypes[index].destructorFunction(wired[index - (isMethod ? 1 : 2)]);
        }
        if (argTypes[0].name !== 'void') return argTypes[0].fromWireType(value);
      };
    }`)
    .replace(method, `function __emval_get_method_caller(argCount, argTypes) {
      const types = __emval_lookupTypes(argCount, argTypes);
      return __emval_addMethodCaller(function(handle, name, destructors, pointer) {
        let offset = 0;
        const args = types.slice(1).map(type => { const value = type.readValueFromPointer(pointer + offset); offset += type.argPackAdvance; return value; });
        const value = handle[name](...args);
        types.slice(1).forEach((type, index) => { if (type.deleteObject) type.deleteObject(args[index]); });
        if (!types[0].isVoid) return types[0].toWireType(destructors, value);
      });
    }`);
  if (/new Function\s*\(|\beval\s*\(|new_\(Function/.test(result)) throw new Error('OCR worker must not require JavaScript eval');
  // Runtime requests are restricted to packaged OCR assets, even on a missing model.
  return `const root = new URL('.', import.meta.url); const localFetch = globalThis.fetch.bind(globalThis); globalThis.fetch = (input, options) => { const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url, root); if (url.protocol !== root.protocol || url.host !== root.host || !url.pathname.startsWith(root.pathname)) return Promise.reject(new Error('OCR only loads packaged local assets')); return localFetch(input, options); };\n${result}\n`;
}

export async function generateOcrAssets(root: string) {
  const sdk = resolve(root, 'node_modules/@paddleocr/paddleocr-js');
  const metadata = JSON.parse(await readFile(resolve(sdk, 'package.json'), 'utf8'));
  if (`${metadata.name}@${metadata.version}` !== manifest.sdk) throw new Error('OCR SDK version must match the reviewed worker');
  const assets = resolve(root, 'artifacts/ocr-build'); await mkdir(assets, { recursive: true });
  const workerName = (await readdir(resolve(sdk, 'dist/assets'))).find(name => /^worker-entry-.*\.js$/.test(name));
  if (!workerName) throw new Error('OCR SDK worker missing');
  const worker = extensionSafeOcrWorker(await readFile(resolve(sdk, 'dist/assets', workerName), 'utf8'));
  await writeFile(resolve(assets, 'worker.js'), worker);
  const dependency = createRequire(resolve(sdk, 'dist/index.mjs'));
  const ort = dirname(dependency.resolve('onnxruntime-web'));
  const files = [{ absoluteSrc: resolve(assets, 'worker.js'), relativeDest: 'ocr-resources/worker.js' }];
  // CPU WASM is deliberate: the extension works without GPU flags in both browsers.
  for (const name of ['ort.wasm.min.mjs', 'ort-wasm-simd-threaded.mjs', 'ort-wasm-simd-threaded.wasm']) {
    files.push({ absoluteSrc: resolve(ort, name), relativeDest: `ocr-resources/${name}` });
  }
  for (const model of manifest.models) {
    const path = resolve(root, 'artifacts/ocr-models', `${model.name}.tar`);
    let bytes: Buffer;
    try { bytes = await readFile(path); }
    catch {
      const response = await fetch(`https://paddle-model-ecology.bj.bcebos.com/paddlex/official_inference_model/paddle3.0.0/${model.name}_onnx_infer.tar`, { signal: AbortSignal.timeout(180000) });
      if (!response.ok) throw new Error(`OCR model download failed: ${model.name} HTTP ${response.status}`);
      bytes = Buffer.from(await response.arrayBuffer());
      await mkdir(dirname(path), { recursive: true }); await writeFile(path, bytes);
    }
    if (bytes.length !== model.bytes || createHash('sha256').update(bytes).digest('hex') !== model.sha256) throw new Error(`OCR model checksum mismatch: ${model.name}`);
    files.push({ absoluteSrc: path, relativeDest: `ocr-resources/${model.name}.tar` });
  }
  files.push({ absoluteSrc: resolve(root, 'data/ocr-models.json'), relativeDest: 'ocr-resources/models.json' });
  files.push({ absoluteSrc: resolve(root, 'data/ocr-NOTICES.txt'), relativeDest: 'ocr-resources/NOTICES.txt' });
  for (const dependencyName of ['onnxruntime-web', '@techstark/opencv-js', 'js-yaml', 'clipper-lib']) {
    let directory = dirname(dependency.resolve(dependencyName));
    while (directory !== dirname(directory)) {
      try { await readFile(resolve(directory, 'package.json')); break; } catch { directory = dirname(directory); }
    }
    for (const name of await readdir(directory)) if (/^(license|licence|notice|copying)(\.|$)/i.test(name)) files.push({ absoluteSrc: resolve(directory, name), relativeDest: `ocr-resources/licenses/${dependencyName.replaceAll('/', '-')}-${name}` });
  }
  return files;
}
