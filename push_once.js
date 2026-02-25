const simpleGit = require('simple-git');
const path = require('path');
const fs = require('fs');

const repoPath = __dirname;
const GIT_PATHS = [
    path.join(process.env.LOCALAPPDATA || '', 'GitHubDesktop', 'app-3.5.5', 'resources', 'app', 'git', 'cmd', 'git.exe'),
    'C:\\Program Files\\Git\\cmd\\git.exe',
    'git'
];
const gitPath = GIT_PATHS.find(p => p !== 'git' && fs.existsSync(p)) || 'git';

async function push() {
    const git = simpleGit({ baseDir: repoPath, binary: gitPath });
    try {
        await git.add('.');
        const status = await git.status();
        if (!status.files.length) {
            console.log('변경사항 없음.');
            process.exit(0);
            return;
        }
        await git.commit('TETRA Sync - welcome DM, character verification, announcements');
        await git.push();
        console.log('✅ GitHub push 완료');
    } catch (err) {
        console.error('❌ 오류:', err.message);
        process.exit(1);
    }
}
push();
