const core = require('@actions/core');
const github = require('@actions/github');
const MultiModuleVersionManager = require('./version-manager');

async function run() {
    try {
        // Get inputs
        const workingDirectory = core.getInput('working-directory');
        const dryRun = core.getInput('dry-run') === 'true';
        const githubToken = core.getInput('github-token');

        // Initialize the octokit client
        const octokit = github.getOctokit(githubToken);

        // Create and execute the version manager
        const manager = new MultiModuleVersionManager(workingDirectory, dryRun);

        // Add GitHub-specific functionality
        manager.createGitTag = async function(node) {
            const tag = `${node.name.replace(':', '-')}-v${node.newVersion}`;
            if (!this.dryRun) {
                const { owner, repo } = github.context.repo;

                // Create tag
                await octokit.rest.git.createRef({
                    owner,
                    repo,
                    ref: `refs/tags/${tag}`,
                    sha: github.context.sha
                });

                // Create release
                // await octokit.rest.repos.createRelease({
                //     owner,
                //     repo,
                //     tag_name: tag,
                //     name: `${node.name} v${node.newVersion}`,
                //     body: await this.generateReleaseNotes(node),
                //     draft: false,
                //     prerelease: false
                // });
            }
            core.info(`Created tag and release: ${tag}`);
        };

        await manager.execute();

    } catch (error) {
        core.setFailed(error.message);
    }
}

run();