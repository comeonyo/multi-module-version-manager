const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

class ModuleNode {
    constructor(name, currentVersion) {
        this.name = name;
        this.currentVersion = currentVersion;
        this.newVersion = null;
        this.changeType = 'none'; // none, patch, minor, major
        this.dependencies = new Set();
        this.dependents = new Set();
        this.path = '';
    }
}

class MultiModuleVersionManager {
    constructor(rootDir, dryRun = false) {
        this.rootDir = rootDir;
        this.dryRun = dryRun;
        this.moduleGraph = new Map();
        this.visitedModules = new Set();
        this.moduleOrder = [];
    }

    async execute() {
        try {
            console.log('멀티 모듈 버전 분석을 시작합니다...');

            await this.buildDependencyGraph();
            this.detectCyclicDependencies();
            await this.analyzeChanges();
            this.calculateNewVersions();

            if (this.dryRun) {
                console.log('Dry-run 모드 활성화: 변경 사항만 출력합니다.');
                this.printDryRunResults();
            } else {
                await this.updateVersions();
                await this.generateChangelogs();
                console.log('버전 관리 프로세스가 완료되었습니다.');
            }
        } catch (error) {
            console.error('버전 관리 중 오류 발생:', error);
            throw error;
        }
    }

    async buildDependencyGraph() {
        console.log('의존성 그래프 구성 중...');

        const settingsPath = path.join(this.rootDir, 'settings.gradle.kts');
        const settingsContent = fs.readFileSync(settingsPath, 'utf8');
        const moduleMatches = settingsContent.matchAll(/include\(\s*['"]([^'"]+)['"]\s*\)/g);

        for (const [, moduleName] of moduleMatches) {
            const modulePath = path.join(this.rootDir, moduleName.replace(':', '/'));
            const buildGradlePath = path.join(modulePath, 'build.gradle.kts');

            if (fs.existsSync(buildGradlePath)) {
                const buildContent = fs.readFileSync(buildGradlePath, 'utf8');
                const version = this.extractVersion(buildContent);

                const moduleNode = new ModuleNode(moduleName, version);
                moduleNode.path = modulePath;
                this.moduleGraph.set(moduleName, moduleNode);

                const dependencies = this.extractDependencies(buildContent);
                for (const dep of dependencies) {
                    if (this.moduleGraph.has(dep)) {
                        moduleNode.dependencies.add(this.moduleGraph.get(dep));
                        this.moduleGraph.get(dep).dependents.add(moduleNode);
                    }
                }
            }
        }
    }

    extractVersion(buildContent) {
        const versionMatch = buildContent.match(/version\s*=\s*['"]([^'"]+)['"]/);
        return versionMatch ? versionMatch[1] : '0.1.0';
    }

    extractDependencies(buildContent) {
        const deps = new Set();
        const depMatches = buildContent.matchAll(/implementation\(\s*project\(['"]:([^'"]+)['"]\)\s*\)/g);
        for (const [, dep] of depMatches) {
            deps.add(dep);
        }
        return deps;
    }

    detectCyclicDependencies() {
        console.log('순환 의존성 검사 중...');

        const detectCycle = (node, path = new Set()) => {
            if (path.has(node.name)) {
                const cycle = Array.from(path).concat(node.name);
                const cycleStr = cycle.slice(cycle.indexOf(node.name)).join(' -> ');
                throw new Error(`순환 의존성 발견: ${cycleStr}`);
            }

            path.add(node.name);

            for (const dependency of node.dependencies) {
                if (detectCycle(dependency, new Set(path))) {
                    return true;
                }
            }

            path.delete(node.name);
            return false;
        };

        for (const node of this.moduleGraph.values()) {
            detectCycle(node);
        }
    }

    async analyzeChanges() {
        console.log('변경사항 분석 중...');

        const lastTag = await this.getLastTag();
        for (const node of this.moduleGraph.values()) {
            console.log(`[디버깅] 분석 중인 모듈: ${node.name} (${node.path})`);
            const changes = await this.getCommitsSinceTag(lastTag, node.path);
            console.log(`[디버깅] ${node.name}의 커밋 수: ${changes.length}`);
            node.changeType = this.determineChangeType(changes);
        }
    }

    async getLastTag() {
        try {
            const result = execSync(
                'git describe --tags --abbrev=0',
                { cwd: this.rootDir, encoding: 'utf8' }
            ).trim();
            return result;
        } catch (error) {
            console.warn('[경고] 태그를 찾을 수 없습니다. 첫 릴리스로 간주합니다.');
            return null;
        }
    }

    async getCommitsSinceTag(lastTag, modulePath) {
        // lastTag가 존재하는 경우: 해당 태그 이후부터 현재 커밋(HEAD)까지의 커밋을 가져옵니다. 예: v1.0.0..HEAD
        // lastTag가 없는 경우: Git 저장소의 모든 커밋(HEAD까지)을 가져옵니다.
        const range = lastTag ? `${lastTag}..HEAD` : 'HEAD';
        try {
            // 현재 디렉토리(modulePath) 내의 파일 변경에 대한 커밋만 포함합니다.
            const result = execSync(
                `git log ${range} --format=%s -- ${modulePath}`,
                { cwd: this.rootDir, encoding: 'utf8' }
            ).trim();
            return result.split('\n').filter(Boolean);
        } catch (error) {
            console.warn(`[경고] ${modulePath}에서 커밋을 가져오는 중 오류 발생: ${error.message}`);
            return [];
        }
    }

    determineChangeType(commits) {
        let changeType = 'none';

        for (const commit of commits) {
            if (commit.startsWith('feat!:') || commit.includes('BREAKING CHANGE')) {
                return 'major';
            } else if (commit.startsWith('feat:') && changeType !== 'major') {
                changeType = 'minor';
            } else if (commit.startsWith('fix:') && changeType === 'none') {
                changeType = 'patch';
            }
        }

        return changeType;
    }

    calculateNewVersions() {
        console.log('새로운 버전 계산 중...');

        this.topologicalSort();

        for (const node of this.moduleOrder) {
            switch (node.changeType) {
                case 'major':
                    node.newVersion = this.incrementVersion(node.currentVersion, 'major');
                    this.updateDependents(node, 'minor');
                    break;
                case 'minor':
                    node.newVersion = this.incrementVersion(node.currentVersion, 'minor');
                    break;
                case 'patch':
                    node.newVersion = this.incrementVersion(node.currentVersion, 'patch');
                    break;
                case 'none':
                    if (Array.from(node.dependencies).some(dep => dep.changeType === 'major')) {
                        node.newVersion = this.incrementVersion(node.currentVersion, 'minor');
                    } else {
                        node.newVersion = node.currentVersion;
                    }
                    break;
            }
        }
    }

    topologicalSort() {
        this.visitedModules.clear();
        this.moduleOrder = [];

        const visit = (node) => {
            if (this.visitedModules.has(node.name)) return;

            this.visitedModules.add(node.name);

            for (const dependency of node.dependencies) {
                visit(dependency);
            }

            this.moduleOrder.push(node);
        };

        for (const node of this.moduleGraph.values()) {
            if (!this.visitedModules.has(node.name)) {
                visit(node);
            }
        }
    }

    incrementVersion(currentVersion, type) {
        const [major, minor, patch] = currentVersion.split('.').map(Number);
        switch (type) {
            case 'major':
                return `${major + 1}.0.0`;
            case 'minor':
                return `${major}.${minor + 1}.0`;
            case 'patch':
                return `${major}.${minor}.${patch + 1}`;
            default:
                throw new Error(`Unknown version increment type: ${type}`);
        }
    }

    updateDependents(node, changeType) {
        for (const dependent of node.dependents) {
            if (dependent.changeType === 'none' || dependent.changeType === 'patch') {
                dependent.changeType = changeType;
            }
        }
    }

    async updateVersions() {
        console.log('버전 정보 업데이트 중...');

        // 변경된 파일들을 추적하기 위한 배열
        const modifiedFiles = [];

        // 1. 먼저 모든 파일 수정
        for (const node of this.moduleOrder) {
            if (node.newVersion) {
                const file = await this.updateGradleVersion(node);
                if (file) modifiedFiles.push(file);
            }
        }

        // 2. 변경사항이 있으면 커밋 생성
        if (modifiedFiles.length > 0 && !this.dryRun) {
            await this.commitChanges(modifiedFiles);
        }

        // 3. 태그 생성
        for (const node of this.moduleOrder) {
            if (node.newVersion) {
                await this.createGitTag(node);
            }
        }
    }

    async updateGradleVersion(node) {
        const buildGradlePath = path.join(node.path, 'build.gradle.kts');
        const content = fs.readFileSync(buildGradlePath, 'utf8');

        const updatedContent = content.replace(
            /version\s*=\s*['"][^'"]+['"]/,
            `version = "${node.newVersion}"`
        );

        if (!this.dryRun) {
            fs.writeFileSync(buildGradlePath, updatedContent);
            console.log(`${node.name}의 버전을 ${node.newVersion}로 업데이트했습니다.`);
            return buildGradlePath;  // 수정된 파일 경로 반환
        } else {
            console.log(`[Dry-run] ${node.name}의 버전을 ${node.newVersion}로 업데이트 예정`);
            return null;
        }
    }

    async commitChanges(files) {
        const { owner, repo } = github.context.repo;

        try {
            // 변경된 파일들을 스테이징
            for (const file of files) {
                execSync(`git add "${file}"`, { cwd: this.rootDir });
            }

            // 커밋 생성
            execSync(
                'git commit -m "chore: Update module versions"',
                { cwd: this.rootDir }
            );

            // GitHub에 푸시
            execSync(
                `git push origin ${github.context.ref}`,
                { cwd: this.rootDir }
            );

            console.log('버전 업데이트 변경사항이 커밋되었습니다.');
        } catch (error) {
            console.error('커밋 생성 중 오류 발생:', error);
            throw error;
        }
    }

    async createGitTag(node) {
        // dry-run 모드 체크를 가장 먼저 수행
        if (this.dryRun) {
            console.log(`[Dry-run] 태그 생성이 스킵됨: ${node.name.replace(':', '-')}-v${node.newVersion}`);
            return;
        }

        const tag = `${node.name.replace(':', '-')}-v${node.newVersion}`;
        const { owner, repo } = github.context.repo;

        try {
            // GitHub API로 태그 존재 여부 확인
            await octokit.rest.git.getRef({
                owner,
                repo,
                ref: `tags/${tag}`
            });
            console.log(`태그가 이미 존재합니다: ${tag}`);
            return;
        } catch (error) {
            if (error.status !== 404) throw error;

            // 태그가 없는 경우에만 생성
            await octokit.rest.git.createRef({
                owner,
                repo,
                ref: `refs/tags/${tag}`,
                sha: github.context.sha
            });
            console.log(`태그 생성: ${tag}`);
        }
    }

    async generateChangelogs() {
        console.log('CHANGELOG 생성 중...');

        for (const node of this.moduleOrder) {
            if (node.newVersion) {
                await this.generateModuleChangelog(node);
            }
        }
    }

    async generateModuleChangelog(node) {
        const changelogPath = path.join(node.path, 'CHANGELOG.md');
        let changelog = `# ${node.name} v${node.newVersion}\n\n`;

        const lastTag = await this.getLastTag(node.path);
        const commits = await this.getCommitsSinceTag(node.path, lastTag);

        const changes = {
            breaking: [],
            features: [],
            fixes: []
        };

        for (const commit of commits) {
            if (commit.startsWith('feat!:') || commit.includes('BREAKING CHANGE')) {
                changes.breaking.push(commit);
            } else if (commit.startsWith('feat:')) {
                changes.features.push(commit);
            } else if (commit.startsWith('fix:')) {
                changes.fixes.push(commit);
            }
        }

        if (changes.breaking.length > 0) {
            changelog += '## ⚠ BREAKING CHANGES\n\n';
            changes.breaking.forEach(commit => {
                changelog += `* ${commit}\n`;
            });
            changelog += '\n';
        }

        if (changes.features.length > 0) {
            changelog += '## ✨ Features\n\n';
            changes.features.forEach(commit => {
                changelog += `* ${commit}\n`;
            });
            changelog += '\n';
        }

        if (changes.fixes.length > 0) {
            changelog += '## 🐛 Bug Fixes\n\n';
            changes.fixes.forEach(commit => {
                changelog += `* ${commit}\n`;
            });
            changelog += '\n';
        }

        let existingChangelog = '';
        try {
            existingChangelog = fs.readFileSync(changelogPath, 'utf8');
        } catch (error) {}

        fs.writeFileSync(changelogPath, changelog + existingChangelog);
        console.log(`${node.name}의 CHANGELOG가 업데이트되었습니다.`);
    }

    printDryRunResults() {
        console.log('Dry-run 결과:');
        for (const node of this.moduleOrder) {
            console.log(`${node.name}:`);
            console.log(`  현재 버전: ${node.currentVersion}`);
            console.log(`  새로운 버전: ${node.newVersion || '변경 없음'}`);
            console.log(`  변경 유형: ${node.changeType}`);
        }
    }
}

module.exports = MultiModuleVersionManager;

const main = async () => {
    const dryRun = process.argv.includes('--dry-run');
    try {
        const manager = new MultiModuleVersionManager(process.cwd(), dryRun);
        await manager.execute();
    } catch (error) {
        console.error('오류 발생:', error);
        process.exit(1);
    }
};

if (require.main === module) {
    main();
}
