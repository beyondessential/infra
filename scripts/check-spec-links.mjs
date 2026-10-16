// Checks that every local link and heading anchor in docs/spec resolves, and that every
// `spec: ID#section` citation in the repository names a spec id and a heading that exist.
//
// Offline and dependency-free. Run from anywhere: node scripts/check-spec-links.mjs
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const specDir = join(root, 'docs', 'spec');

const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8' });
const specFiles = git('ls-files', '-co', '--exclude-standard', 'docs/spec')
  .split('\n')
  .filter((f) => f.startsWith('docs/spec/') && f.endsWith('.md'));

// GitHub's heading slug: lower-case, drop punctuation other than hyphens, spaces to hyphens.
const slug = (heading) =>
  heading
    .trim()
    .toLowerCase()
    .replace(/`/g, '')
    .replace(/[^\p{L}\p{N}\s_-]/gu, '')
    .replace(/\s/g, '-');

const anchorsOf = (text) => {
  const anchors = new Set();
  let fenced = false;
  for (const line of text.split('\n')) {
    if (line.startsWith('```')) fenced = !fenced;
    const heading = !fenced && /^#{1,6}\s+(.*)$/.exec(line);
    if (heading) anchors.add(slug(heading[1]));
  }
  return anchors;
};

const anchorCache = new Map();
const anchors = (path) => {
  if (!anchorCache.has(path)) anchorCache.set(path, anchorsOf(readFileSync(path, 'utf8')));
  return anchorCache.get(path);
};

const problems = [];
const ids = new Map();

for (const file of specFiles) {
  const text = readFileSync(join(root, file), 'utf8');
  const id = /^---\nid: ([A-Z0-9]{2,6})\n---\n/.exec(text)?.[1];
  if (!id) {
    problems.push(`${file}: missing or malformed id in frontmatter`);
    continue;
  }
  if (ids.has(id)) problems.push(`${file}: id ${id} is also used by ${ids.get(id)}`);
  ids.set(id, file);
}

for (const file of specFiles) {
  const path = join(root, file);
  const text = readFileSync(path, 'utf8');
  for (const [, target] of text.matchAll(/\]\(([^)\s]+)\)/g)) {
    if (/^[a-z][a-z0-9+.-]*:/i.test(target)) continue;
    const [rel, anchor] = target.split('#');
    const dest = rel === '' ? path : resolve(dirname(path), rel);
    if (!existsSync(dest)) {
      problems.push(`${file}: link to missing file ${target}`);
    } else if (anchor && dest.endsWith('.md') && !anchors(dest).has(anchor)) {
      problems.push(`${file}: link to missing heading ${target}`);
    }
  }
}

const citations = git('grep', '-nE', '(spec|plan): [A-Za-z0-9_./-]+#[a-z0-9-]+', '--', '.', ':!docs/spec', ':!.workhorse', ':!.agents', ':!scripts/check-spec-links.mjs');
for (const line of citations.split('\n').filter(Boolean)) {
  const [file, number] = line.split(':');
  for (const [, kind, ref, anchor] of line.matchAll(/\b(spec|plan): ([A-Za-z0-9_./-]+)#([a-z0-9-]+)/g)) {
    const where = `${file}:${number}`;
    if (kind === 'spec') {
      const target = ids.get(ref);
      if (!target) problems.push(`${where}: no spec has id ${ref}`);
      else if (!anchors(join(root, target)).has(anchor)) problems.push(`${where}: ${ref} has no heading ${anchor}`);
    } else {
      const target = join(root, ref);
      if (!existsSync(target)) problems.push(`${where}: no file ${ref}`);
      else if (!anchors(target).has(anchor)) problems.push(`${where}: ${ref} has no heading ${anchor}`);
    }
  }
}

if (problems.length > 0) {
  console.error(problems.join('\n'));
  process.exit(1);
}
console.log(`${specFiles.length} specs, ${ids.size} ids, links and citations resolve`);
