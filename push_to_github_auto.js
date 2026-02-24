/**
 * 파일 변경 감지 시 자동으로 GitHub에 push
 * 실행: node push_to_github_auto.js (백그라운드로 계속 실행)
 * 또는: npm run push:auto
 */
const simpleGit = require('simple-git');
const path = require('path');
const fs = require('fs');

const repoPath = __dirname;
const GIT_PATHS = [
    'C:\\Users\\FAMILY\\AppData\\Local\\GitHubDesktop\\app-3.5.5\\resources\\app\\git\\cmd\\git.exe',
    path.join(process.env.LOCALAPPDATA || '', 'GitHubDesktop', 'app-3.5.5', 'resources', 'app', 'git', 'cmd', 'git.exe'),
    'git'
];
const gitPath = GIT_PATHS.find(p => p !== 'git' && fs.existsSync(p)) || 'git';
const remote = 'https://github.com/vacagencydev-ringring/tetra.git';

const DEBOUNCE_MS = 30_000;  // 변경 후 30초 대기 후 push

let lastPushAt = 0;
let pendingPush = null;

const IGNORE = [
    'node_modules', '.git', 'terminals', '*.log',
    'credentials.json.json', '.env', '.env.*'
];

async function doPush() {
    const git = simpleGit({ baseDir: repoPath, binary: gitPath });
    try {
        await git.init();
        await git.add('.');
        try {
            await git.commit('TETRA Sync Bot', ['--amend', '-m', 'TETRA Sync Bot']);
        } catch (e) {
            try {
                await git.commit('TETRA Sync Bot');
            } catch (e2) {
                if (!e2.message?.includes('nothing to commit')) throw e2;
                return;
            }
        }
        await git.branch(['-M', 'main']);
        try { await git.remote(['remove', 'origin']); } catch (_) {}
        await git.remote(['add', 'origin', remote]);
        await git.push(['-u', 'origin', 'main', '--force']);
        lastPushAt = Date.now();
        console.log(`[${new Date().toLocaleTimeString()}] ✅ GitHub push 완료`);
    } catch (err) {
        console.error(`[${new Date().toLocaleTimeString()}] ❌ Push 실패:`, err.message);
    }
}

function schedulePush() {
    if (pendingPush) clearTimeout(pendingPush);
    pendingPush = setTimeout(() => {
        pendingPush = null;
        doPush().catch(() => {});
    }, DEBOUNCE_MS);
}

function shouldIgnore(filePath) {
    const rel = path.relative(repoPath, filePath);
    return IGNORE.some(p => rel.includes(p.replace('*', '')) || rel.startsWith('.'));
}

fs.watch(repoPath, { recursive: true }, (ev, name) => {
    if (!name || name.includes('node_modules') || name.includes('.git')) return;
    if (shouldIgnore(path.join(repoPath, name))) return;
    console.log(`[${new Date().toLocaleTimeString()}] 변경 감지: ${name}`);
    schedulePush();
});

console.log('🔁 자동 GitHub push 감시 시작 (파일 변경 후 ' + (DEBOUNCE_MS / 1000) + '초 뒤 push)');
console.log('   중지: Ctrl+C');
doPush().then(() => {}).catch(() => {});
