/**
 * 확인 없이 바로 GitHub push
 * node push_now.js
 */
const { execSync } = require('child_process');
const path = require('path');

const repoPath = __dirname;

function run(cmd, opts = {}) {
  try {
    return execSync(cmd, { cwd: repoPath, encoding: 'utf8', ...opts });
  } catch (e) {
    throw new Error(e.stderr || e.message);
  }
}

(async () => {
  try {
    const status = run('git status --porcelain');
    if (!status.trim()) {
      console.log('변경사항 없음. 이미 push 되어 있을 수 있습니다.');
      run('git push origin main 2>&1');
      process.exit(0);
      return;
    }
    console.log('[1/3] add + commit...');
    run('git add -A');
    run('git commit -m "TETRA: 링크 패널, 다중 테이블, 타임아웃"');
    console.log('[2/3] push...');
    run('git push origin main');
    console.log('[3/3] 완료');
  } catch (err) {
    if (err.message?.includes('nothing to commit')) {
      console.log('커밋할 변경 없음. push만 시도...');
      run('git push origin main 2>&1');
      return;
    }
    console.error('❌', err.message);
    process.exit(1);
  }
})();
