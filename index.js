const fs = require("fs");
const core = require("@actions/core");
const exec = require("@actions/exec");
const { cosmiconfig } = require("cosmiconfig");
const pluralize = require("pluralize");

const MAIN_BRANCHES = ["main", "master"];
let updateDetails = [];

async function getCommandOutput(commandLine, args) {
  let stdout = "";
  const options = {
    listeners: {
      stdout: (data) => (stdout += data.toString())
    }
  };
  await exec.exec(commandLine, args, options);
  return stdout;
}

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
  const latestVersion = (await getCommandOutput("npm", ["view", `${pkgName}@${pkgTag}`, "version"])).trim();

  if (currentVersion !== latestVersion) {
    const npmArgs = dev ? ["--save-dev"] : ["--save-prod", "--save-exact"];
    await exec.exec("npm", ["install", `${pkgName}@${latestVersion}`, ...npmArgs]);
    updateDetails.push(`${pkgName}: ${currentVersion} -> ${latestVersion}`);
  }
}

(async () => {
  const { config } = await cosmiconfig("release").search();
  const branchName = process.env.GITHUB_BASE_REF || process.env.GITHUB_REF.replace(/^refs\/heads\//, "");
  const branch = config.branches.find((branch) => branch.name === branchName);

  if (branch != null) {
    const dependencies = getDependencies(branch, false);
    const devDependencies = getDependencies(branch, true);
    const changedFiles = ["package.json", "package-lock.json"];

    core.info(`Checking for updates to ${pluralize("dependency", Object.keys(dependencies).length, true)} and ` +
      `${pluralize("dev dependency", Object.keys(devDependencies).length, true)}`);

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
      changedFiles.push("**/package.json");
      const dependencyList = [...Object.keys(dependencies), ...Object.keys(devDependencies)];

      await exec.exec("npx", ["-y", "--", "syncpack", "fix-mismatches", "--dev", "--prod", "--filter", dependencyList.join("|")]);
      await exec.exec("git", ["checkout", "package-lock.json"]);
      await exec.exec("npm", ["install"]);
    }

    if (updateDetails.length > 0 && core.getInput("commit") === "true") {
      await exec.exec("git", ["add", ...changedFiles]);
      await exec.exec("git", ["commit", "-s", "-m", "Update dependencies\n\n" + updateDetails.join("\n")]);
    }
  } else {
    core.info("Nothing to do since this is not a protected branch or a PR based on one");
  }
})().catch((error) => {
  core.setFailed(error.message);
});
