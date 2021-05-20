const fs = require("fs");
const core = require("@actions/core");
const { cosmiconfig } = require("cosmiconfig");
const execa = require("execa");

const MAIN_BRANCHES = ["main", "master"];

function getDependencies(branch, dev) {
  const dependencies = dev ? branch.devDependencies : branch.dependencies;
  if (!Array.isArray(dependencies)) {
    return dependencies || {};
  }

  const dependencyMap = {};
  for (const pkgName of dependencies) {
    dependencyMap[pkgName] = branch.channel || (MAIN_BRANCHES.includes(branch.name) ? "latest" : branch.name);
  }

  return dependencyMap;
}

async function updateDependency(pkgName, pkgTag, dev) {
  const packageJson = JSON.parse(fs.readFileSync("package.json", "utf-8"));
  const dependencies = packageJson[dev ? "devDependencies" : "dependencies"] || {};
  const currentVersion = dependencies[pkgName];
  const latestVersion = (await execa("npm", ["view", `${pkgName}@${pkgTag}`, "version"])).stdout;

  if (currentVersion !== latestVersion) {
    const npmArgs = dev ? ["--save-dev"] : ["--save-prod", "--save-exact"];
    await execa("npm", ["install", `${pkgName}@${latestVersion}`, ...npmArgs]);
  }
}

(async () => {
  const { config } = await cosmiconfig("release").search();
  const branchName = process.env.GITHUB_BASE_REF || process.env.GITHUB_REF.replace(/^refs\/heads\//, "");
  const branch = config.branches.find((branch) => branch.name === branchName);

  if (branch != null) {
    const dependencies = getDependencies(branch, false);
    const devDependencies = getDependencies(branch, true);

    if (branch.dependencies) {
      for (const [pkgName, pkgTag] of Object.entries(dependencies)) {
        await updateDependency(pkgName, pkgTag, false);
      }
    }

    if (branch.devDependencies) {
      for (const [pkgName, pkgTag] of Object.entries(devDependencies)) {
        await updateDependency(pkgName, pkgTag, true);
      }
    }

    if (fs.existsSync("lerna.json") && (branch.dependencies || branch.devDependencies)) {
      const dependencyList = [...Object.keys(dependencies), ...Object.keys(devDependencies)];
      await execa("npx", ["-y", "--", "syncpack", "fix-mismatches", "--dev", "--prod", "--filter", dependencyList.join("|")]);
      await execa("git", ["checkout", "package-lock.json"]);
      await execa("npm", ["install"]);
    }
  } else {
    core.info("Nothing to do since this is not a protected branch or a PR based on one");
  }
})().catch((error) => {
  core.setFailed(error.message);
});
