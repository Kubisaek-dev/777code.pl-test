import fs from 'node:fs';
import path from 'node:path';

export function createDb(filePath) {
  const abs = path.resolve(filePath);
  const dir = path.dirname(abs);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

  if (!fs.existsSync(abs)) {
    fs.writeFileSync(
      abs,
      JSON.stringify({ licenses: [], audit: [] }, null, 2),
      'utf8'
    );
  }

  function read() {
    return JSON.parse(fs.readFileSync(abs, 'utf8'));
  }

  function write(data) {
    fs.writeFileSync(abs, JSON.stringify(data, null, 2), 'utf8');
  }

  function withData(mutator) {
    const data = read();
    const out = mutator(data) || data;
    write(out);
    return out;
  }

  return { read, write, withData, file: abs };
}
