/******/ (() => { // webpackBootstrap
/******/ 	var __webpack_modules__ = ({

/***/ 431:
/***/ (function(__unused_webpack_module, exports, __nccwpck_require__) {

"use strict";

var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || function (mod) {
    if (mod && mod.__esModule) return mod;
    var result = {};
    if (mod != null) for (var k in mod) if (k !== "default" && Object.prototype.hasOwnProperty.call(mod, k)) __createBinding(result, mod, k);
    __setModuleDefault(result, mod);
    return result;
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", ({ value: true }));
exports.run = run;
const core = __importStar(__nccwpck_require__(838));
const exec_1 = __nccwpck_require__(18);
const artifact_1 = __nccwpck_require__(325);
const path = __importStar(__nccwpck_require__(17));
const fs_1 = __importDefault(__nccwpck_require__(147));
var PathType;
(function (PathType) {
    PathType["URL"] = "url";
    PathType["RELATIVE"] = "relative";
})(PathType || (PathType = {}));
/**
 * The main function for the action.
 * @returns {Promise<void>} Resolves when the action is complete.
 */
async function run() {
    try {
        validateInputsAndEnv();
        const pathTypes = await getFilePathTypes();
        await installCorelliumCli();
        const existingInstance = core.getInput('existingInstance');
        const existingBundleId = core.getInput('bundleId');
        const projectId = process.env.PROJECT;
        let instanceId;
        let bundleId;
        if (!existingInstance) {
            const setupResult = await setupDevice(pathTypes);
            instanceId = setupResult.instanceId;
            bundleId = setupResult.bundleId;
        }
        else {
            await instanceCheck(existingInstance);
            instanceId = existingInstance;
            bundleId = existingBundleId;
        }
        const report = await runMatrix(projectId, instanceId, bundleId, pathTypes);
        if (!existingInstance) {
            await cleanup(instanceId);
        }
        await storeReportInArtifacts(report, bundleId);
    }
    catch (error) {
        if (error instanceof Error) {
            core.setFailed(error.message);
        }
    }
}
async function installCorelliumCli() {
    core.info('Installing Corellium-CLI...');
    try {
        await execCmd('npm install -g @corellium/corellium-cli@1.3.2');
    }
    catch (error) {
        if (error instanceof Error && error.message.includes('deprecated uuid')) {
            core.warning('UUID deprecation warning encountered, but continuing as it is non-critical.');
        }
        else {
            throw new Error(`Error occurred executing npm install: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
    }
}
async function instanceCheck(instanceId) {
    core.info('Connecting to Corellium...');
    await execCmd(`corellium login --endpoint ${core.getInput('server')} --apitoken ${process.env.API_TOKEN}`);
    core.info(`Checking status of instance with ID: ${instanceId}...`);
    let instanceDetails = await getInstanceStatus(instanceId);
    if (instanceDetails.state !== 'on') {
        core.info(`Instance is not ready. Current status: ${instanceDetails.state}, Agent status: ${instanceDetails.ready}`);
        core.info('Starting instance...');
        await execCmd(`corellium instance start ${instanceId}`);
    }
    core.info('Waiting for instance to be ready...');
    instanceDetails = await pollInstanceStatus(instanceId);
    if (instanceDetails.ready) {
        core.info('Instance is now ready.');
    }
    else {
        throw new Error('Instance did not reach ready status.');
    }
}
async function getInstanceStatus(instanceId) {
    try {
        core.info(`Fetching status for instance ID: ${instanceId}...`);
        const apiOutput = await execCmd(`corellium instance get --instance ${instanceId}`);
        return JSON.parse(apiOutput);
    }
    catch (error) {
        core.error(`Error fetching instance status: ${error instanceof Error ? error.message : 'Unknown error'}`);
        throw error;
    }
}
async function pollInstanceStatus(instanceId) {
    const pollInterval = 30000;
    const maxRetries = 60;
    for (let i = 0; i < maxRetries; i++) {
        try {
            const instanceDetails = await getInstanceReady(instanceId);
            if (instanceDetails.ready) {
                return instanceDetails;
            }
            core.info(`Instance not ready yet. Retrying in ${pollInterval / 1000} seconds...`);
            await new Promise(resolve => setTimeout(resolve, pollInterval));
        }
        catch (error) {
            if (error instanceof Error && error.message.includes("Agent not yet available")) {
                continue;
            }
            else {
                core.error(`Error during polling: ${error instanceof Error ? error.message : 'Unknown error'}`);
                throw error;
            }
        }
    }
    throw new Error('Timed out waiting for instance to be ready.');
}
async function getInstanceReady(instanceId) {
    try {
        const projectId = process.env.PROJECT;
        const apiOutput = await execCmd(`corellium instance ready --project ${projectId} --instance ${instanceId}`);
        return JSON.parse(apiOutput);
    }
    catch (error) {
        if (error instanceof Error && !error.message.includes("Agent not yet available")) {
            core.error(`Error fetching readiness status: ${error.message}`);
        }
        throw error;
    }
}
async function setupDevice(pathTypes) {
    const projectId = process.env.PROJECT;
    core.info('Connecting to Corellium...');
    await execCmd(`corellium login --endpoint ${core.getInput('server')} --apitoken ${process.env.API_TOKEN}`);
    core.info('Creating device...');
    const resp = await execCmd(`corellium instance create ${core.getInput('deviceFlavor')} ${core.getInput('deviceOS')} ${projectId} --wait`);
    const instanceId = resp.toString().trim();
    core.info('Downloading app...');
    const appPath = await downloadFile('appFile', core.getInput('appPath'), pathTypes.appPath);
    core.info(`Installing app on ${instanceId}...`);
    await execCmd(`corellium apps install --project ${projectId} --instance ${instanceId} --app ${appPath}`);
    const instanceStr = await execCmd(`corellium instance get --instance ${instanceId}`);
    const instance = tryJsonParse(instanceStr);
    if (instance?.type === 'ios') {
        core.info('Unlocking device...');
        await execCmd(`corellium instance unlock --instance ${instanceId}`);
    }
    const bundleId = await getBundleId(instanceId);
    core.info(`Opening ${bundleId} on ${instanceId}...`);
    await execCmd(`corellium apps open --project ${projectId} --instance ${instanceId} --bundle ${bundleId}`);
    return { instanceId, bundleId };
}
async function runMatrix(projectId, instanceId, bundleId, pathTypes) {
    const [wordlistId, inputInfo] = await Promise.all([
        uploadWordlistFile(instanceId, pathTypes.keywords),
        downloadInputFile(pathTypes.userActions),
    ]);
    const inputsFilePath = inputInfo.inputsFilePath;
    const inputsTimeout = inputInfo.inputsTimeout;
    core.info('Running MATRIX...');
    const instanceStr = await execCmd(`corellium instance get --instance ${instanceId}`);
    const instance = tryJsonParse(instanceStr);
    if (instance?.type === 'ios') {
        core.info('Unlocking device...');
        await execCmd(`corellium instance unlock --instance ${instanceId}`);
    }
    core.info(`Opening ${bundleId} on ${instanceId}...`);
    try {
        await execCmd(`corellium apps open --project ${projectId} --instance ${instanceId} --bundle ${bundleId}`);
    }
    catch (error) {
        if (error instanceof Error && error.message.includes('App not installed')) {
            core.info(`App not installed. Installing the app...`);
            const appPath = await downloadFile('appFile', core.getInput('appPath'), pathTypes.appPath);
            await execCmd(`corellium apps install --project ${projectId} --instance ${instanceId} --app ${appPath}`);
            const waitTime = 120000;
            core.info(`Waiting ${waitTime}ms before retrying to open the app...`);
            await wait(waitTime);
            core.info('Retrying to open the app...');
            await execCmd(`corellium apps open --project ${projectId} --instance ${instanceId} --bundle ${bundleId}`);
        }
        else {
            throw error;
        }
    }
    core.info('Creating assessment...');
    let assessmentId;
    try {
        let createAssessment = `corellium matrix create-assessment --instance ${instanceId} --bundle ${bundleId}`;
        if (wordlistId) {
            createAssessment += ` --wordlist ${wordlistId}`;
        }
        const resp = await execCmd(createAssessment);
        assessmentId = tryJsonParse(resp)?.id;
        core.info(`Created assessment ${assessmentId}...`);
    }
    catch (err) {
        throw new Error(`Error creating MATRIX assessment! err=${err}`);
    }
    await pollAssessmentForStatus(assessmentId, instanceId, 'new');
    core.info('Starting monitor...');
    await execCmd(`corellium matrix start-monitor --instance ${instanceId} --assessment ${assessmentId}`);
    await pollAssessmentForStatus(assessmentId, instanceId, 'monitoring');
    core.info('Executing inputs on device...');
    await execCmd(`corellium input ${instanceId} ${inputsFilePath}`);
    core.info(`Waiting ${inputsTimeout}ms for inputs to execute...`);
    await wait(inputsTimeout);
    core.info('Stopping monitor...');
    await execCmd(`corellium matrix stop-monitor --instance ${instanceId} --assessment ${assessmentId}`);
    await pollAssessmentForStatus(assessmentId, instanceId, 'readyForTesting');
    core.info('Executing tests...');
    await execCmd(`corellium matrix test --instance ${instanceId} --assessment ${assessmentId}`);
    await pollAssessmentForStatus(assessmentId, instanceId, 'complete');
    core.info('Downloading assessment...');
    return await execCmd(`corellium matrix download-report --instance ${instanceId} --assessment ${assessmentId}`);
}
async function cleanup(instanceId) {
    core.info('Cleaning up...');
    await execCmd(`corellium instance stop ${instanceId}`);
    await execCmd(`corellium instance delete ${instanceId}`);
    await execCmd(`corellium logout`);
}
async function getBundleId(instanceId) {
    const resp = await execCmd(`corellium apps --project ${process.env.PROJECT} --instance ${instanceId}`);
    const appList = tryJsonParse(resp);
    const bundleId = appList?.find((app) => app.applicationType === 'User')?.bundleID;
    if (!bundleId) {
        throw new Error('Error getting bundleId!');
    }
    return bundleId;
}
async function uploadWordlistFile(instanceId, pathType) {
    const keywords = core.getInput('keywords');
    if (!keywords) {
        return undefined;
    }
    core.info('Uploading wordlist...');
    const wordlistPath = await downloadFile('wordlist.txt', keywords, pathType);
    const resp = await execCmd(`corellium image create --project ${process.env.PROJECT} --instance ${instanceId} --format json wordlist.txt mast-wordlist plain ${wordlistPath}`);
    const uploadedWordlistResp = tryJsonParse(resp);
    const wordlistId = uploadedWordlistResp?.[0].id;
    core.info(`Uploaded wordlist: ${wordlistId}`);
    return wordlistId;
}
async function downloadInputFile(pathType) {
    const inputsFilePath = await downloadFile('inputs.json', core.getInput('userActions'), pathType);
    const inputsJson = JSON.parse(fs_1.default.readFileSync(inputsFilePath, 'utf-8'));
    const inputsTimeout = inputsJson.reduce((acc, curr) => {
        if (curr.wait) {
            acc += curr.wait;
        }
        if (curr.duration) {
            acc += curr.duration;
        }
        return acc;
    }, 10000);
    return { inputsFilePath, inputsTimeout };
}
async function pollAssessmentForStatus(assessmentId, instanceId, expectedStatus) {
    const getAssessmentStatus = async () => {
        const resp = await execCmd(`corellium matrix get-assessment --instance ${instanceId} --assessment ${assessmentId}`);
        return tryJsonParse(resp)?.status;
    };
    let actualStatus = await getAssessmentStatus();
    while (actualStatus !== expectedStatus) {
        await wait();
        actualStatus = await getAssessmentStatus();
        if (actualStatus === 'failed') {
            throw new Error('MATRIX automated test failed!');
        }
    }
    return actualStatus;
}
async function storeReportInArtifacts(report, bundleId) {
    const workspaceDir = process.env.GITHUB_WORKSPACE;
    const reportFormat = core.getInput('reportFormat') || 'json';
    const reportFileName = `report.${reportFormat}`;
    const reportPath = path.join(workspaceDir, reportFileName);
    fs_1.default.writeFileSync(reportPath, report);
    const flavor = core.getInput('deviceFlavor');
    const artifact = new artifact_1.DefaultArtifactClient();
    const { id } = await artifact.uploadArtifact(`matrix-report-${flavor}-${bundleId}`, [reportPath], workspaceDir);
    if (!id) {
        throw new Error('Failed to upload MATRIX report artifact!');
    }
    const { downloadPath } = await artifact.downloadArtifact(id);
    core.setOutput('report', downloadPath);
}
function validateInputsAndEnv() {
    if (!process.env.API_TOKEN) {
        throw new Error('Environment secret missing: API_TOKEN');
    }
    if (!process.env.PROJECT) {
        throw new Error('Environment secret missing: PROJECT');
    }
    const requiredInputs = ['appPath', 'userActions'];
    requiredInputs.forEach((input) => {
        const inputResp = core.getInput(input);
        if (!inputResp || typeof inputResp !== 'string' || inputResp === '') {
            throw new Error(`Input required and not supplied: ${input}`);
        }
    });
}
async function downloadFile(fileNameToSave, pathValue, pathType) {
    const workspaceDir = process.env.GITHUB_WORKSPACE;
    const downloadPath = path.join(workspaceDir, fileNameToSave);
    if (pathType === PathType.URL) {
        await (0, exec_1.exec)(`curl -L -o ${downloadPath} ${pathValue}`, [], { silent: true });
        return downloadPath;
    }
    else {
        return `${workspaceDir}${pathValue.startsWith('/') ? pathValue : `/${pathValue}`}`;
    }
}
async function wait(ms = 3000) {
    return new Promise(resolve => setTimeout(resolve, ms));
}
async function execCmd(cmd) {
    let err = '';
    let resp = '';
    await (0, exec_1.exec)(cmd, [], {
        silent: true,
        ignoreReturnCode: true,
        listeners: {
            stdout: (data) => {
                resp += data.toString();
            },
            stderr: (data) => {
                err += data.toString();
            },
        },
    });
    if (err) {
        throw new Error(`Error occurred executing ${cmd} err=${err}`);
    }
    return resp;
}
async function getFilePathTypes() {
    const pathInputs = ['appPath', 'userActions', 'keywords'];
    const workspaceDir = process.env.GITHUB_WORKSPACE;
    const pathInputsWithTypes = {};
    for (const pathInput of pathInputs) {
        const filePath = core.getInput(pathInput);
        if (filePath) {
            try {
                new URL(filePath);
                pathInputsWithTypes[pathInput] = PathType.URL;
                continue;
            }
            catch (_) {
                const fullPath = `${workspaceDir}${filePath.startsWith('/') ? filePath : `/${filePath}`}`;
                if (await fs_1.default.promises.stat(fullPath).catch(() => false)) {
                    pathInputsWithTypes[pathInput] = PathType.RELATIVE;
                    continue;
                }
                throw new Error(`Provided file path is invalid: ${pathInput}`);
            }
        }
    }
    return pathInputsWithTypes;
}
function tryJsonParse(jsonStr) {
    let obj = undefined;
    if (jsonStr && typeof jsonStr === 'string' && jsonStr !== '') {
        try {
            obj = JSON.parse(jsonStr);
        }
        catch (err) {
            // do nothing
        }
    }
    return obj;
}
//# sourceMappingURL=main.js.map

/***/ }),

/***/ 325:
/***/ ((module) => {

module.exports = eval("require")("@actions/artifact");


/***/ }),

/***/ 838:
/***/ ((module) => {

module.exports = eval("require")("@actions/core");


/***/ }),

/***/ 18:
/***/ ((module) => {

module.exports = eval("require")("@actions/exec");


/***/ }),

/***/ 147:
/***/ ((module) => {

"use strict";
module.exports = require("fs");

/***/ }),

/***/ 17:
/***/ ((module) => {

"use strict";
module.exports = require("path");

/***/ })

/******/ 	});
/************************************************************************/
/******/ 	// The module cache
/******/ 	var __webpack_module_cache__ = {};
/******/ 	
/******/ 	// The require function
/******/ 	function __nccwpck_require__(moduleId) {
/******/ 		// Check if module is in cache
/******/ 		var cachedModule = __webpack_module_cache__[moduleId];
/******/ 		if (cachedModule !== undefined) {
/******/ 			return cachedModule.exports;
/******/ 		}
/******/ 		// Create a new module (and put it into the cache)
/******/ 		var module = __webpack_module_cache__[moduleId] = {
/******/ 			// no module.id needed
/******/ 			// no module.loaded needed
/******/ 			exports: {}
/******/ 		};
/******/ 	
/******/ 		// Execute the module function
/******/ 		var threw = true;
/******/ 		try {
/******/ 			__webpack_modules__[moduleId].call(module.exports, module, module.exports, __nccwpck_require__);
/******/ 			threw = false;
/******/ 		} finally {
/******/ 			if(threw) delete __webpack_module_cache__[moduleId];
/******/ 		}
/******/ 	
/******/ 		// Return the exports of the module
/******/ 		return module.exports;
/******/ 	}
/******/ 	
/************************************************************************/
/******/ 	/* webpack/runtime/compat */
/******/ 	
/******/ 	if (typeof __nccwpck_require__ !== 'undefined') __nccwpck_require__.ab = __dirname + "/";
/******/ 	
/************************************************************************/
/******/ 	
/******/ 	// startup
/******/ 	// Load entry module and return exports
/******/ 	// This entry module is referenced by other modules so it can't be inlined
/******/ 	var __webpack_exports__ = __nccwpck_require__(431);
/******/ 	module.exports = __webpack_exports__;
/******/ 	
/******/ })()
;