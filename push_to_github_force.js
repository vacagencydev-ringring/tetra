/**
 * GitHub Push (자동 확인, 확인 없이 바로 푸시)
 * 터미널에서: node push_to_github_force.js
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

async function push() {
    const git = simpleGit({ baseDir: repoPath, binary: gitPath });
    try {
        console.log('[1/6] Git 초기화...');
        await git.init();
        
        console.log('[2/6] 파일 추가...');
        await git.add('.');
        
        console.log('[3/6] 커밋...');
        try {
            await git.commit('TETRA Sync Bot');
        } catch (e) {
            if (!e.message?.includes('nothing to commit')) throw e;
            console.log('   (변경 없음, 스킵)');
        }
        
        console.log('[4/6] 브랜치 설정...');
        await git.branch(['-M', 'main']);
        
        console.log('[5/6] 원격 연결...');
        try { await git.remote(['remove', 'origin']); } catch (_) {}
        await git.remote(['add', 'origin', remote]);
        
        console.log('[6/6] Push...');
        await git.push(['-u', 'origin', 'main', '--force']);
        
        console.log('\n✅ 완료! https://github.com/vacagencydev-ringring/tetra');
    } catch (err) {
        console.error('\n❌ 오류:', err.message);
        process.exit(1);
    }
}

push();
