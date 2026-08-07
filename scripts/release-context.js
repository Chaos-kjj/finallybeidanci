const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

function realpath(value) {
  try { return fs.realpathSync(value); } catch (_) { return path.resolve(value); }
}

function primaryWorktree(cwd) {
  const result = spawnSync('git', ['worktree', 'list', '--porcelain'], { cwd, encoding: 'utf8' });
  if (result.status !== 0) throw new Error(`无法确定主工作区：${String(result.stderr || result.error || '').trim()}`);
  const first = String(result.stdout || '').match(/^worktree (.+)$/m)?.[1];
  if (!first) throw new Error('git worktree 没有返回主工作区');
  return realpath(first);
}

function releaseContext(cwd) {
  const workspace = realpath(cwd);
  const primary = primaryWorktree(cwd);
  return { workspace, primary, canonical: workspace === primary };
}

module.exports = { primaryWorktree, releaseContext };
