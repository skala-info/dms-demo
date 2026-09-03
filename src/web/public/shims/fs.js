// shims/fs.js — a read-only filesystem over files fetched at boot.
//
// demo1 reads exactly one kind of file at runtime: the seven email templates, via
// `fs.readFileSync` in templates/index.js. Those are fetched before the app starts and
// registered here by basename. Writes (the file email adapter, the store flushing
// db.json) have nowhere to go in a browser and are accepted and dropped — the browser
// build selects the in-memory adapters, so nothing depends on them.
const files = new Map();

/** Called by boot.js once the template sources have been fetched. */
export const registerFile = (name, contents) => files.set(name.split('/').pop(), contents);

const lookup = (target) => files.get(String(target).split('/').pop());

export const existsSync = (target) => lookup(target) !== undefined;
export function readFileSync(target) {
  const contents = lookup(target);
  if (contents === undefined) {
    const error = new Error(`ENOENT: no such file or directory, open '${target}'`);
    error.code = 'ENOENT';
    throw error;
  }
  return contents;
}
export const statSync = (target) => {
  if (!existsSync(target)) { const e = new Error(`ENOENT: ${target}`); e.code = 'ENOENT'; throw e; }
  return { isFile: () => true, isDirectory: () => false };
};
export const writeFileSync = () => undefined;
export const mkdirSync = () => undefined;
export const appendFileSync = () => undefined;
export const readdirSync = () => [];

export default { existsSync, readFileSync, statSync, writeFileSync, mkdirSync, appendFileSync, readdirSync, registerFile };
