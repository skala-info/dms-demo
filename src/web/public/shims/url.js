// shims/url.js — demo1 only uses fileURLToPath, to locate a module's own directory.
export const fileURLToPath = (url) => {
  const text = String(url);
  return text.startsWith('file://') ? text.slice('file://'.length) : new URL(text, location.href).pathname;
};
export default { fileURLToPath };
