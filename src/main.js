"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var __generator = (this && this.__generator) || function (thisArg, body) {
    var _ = { label: 0, sent: function() { if (t[0] & 1) throw t[1]; return t[1]; }, trys: [], ops: [] }, f, y, t, g;
    return g = { next: verb(0), "throw": verb(1), "return": verb(2) }, typeof Symbol === "function" && (g[Symbol.iterator] = function() { return this; }), g;
    function verb(n) { return function (v) { return step([n, v]); }; }
    function step(op) {
        if (f) throw new TypeError("Generator is already executing.");
        while (g && (g = 0, op[0] && (_ = 0)), _) try {
            if (f = 1, y && (t = op[0] & 2 ? y["return"] : op[0] ? y["throw"] || ((t = y["return"]) && t.call(y), 0) : y.next) && !(t = t.call(y, op[1])).done) return t;
            if (y = 0, t) op = [op[0] & 2, t.value];
            switch (op[0]) {
                case 0: case 1: t = op; break;
                case 4: _.label++; return { value: op[1], done: false };
                case 5: _.label++; y = op[1]; op = [0]; continue;
                case 7: op = _.ops.pop(); _.trys.pop(); continue;
                default:
                    if (!(t = _.trys, t = t.length > 0 && t[t.length - 1]) && (op[0] === 6 || op[0] === 2)) { _ = 0; continue; }
                    if (op[0] === 3 && (!t || (op[1] > t[0] && op[1] < t[3]))) { _.label = op[1]; break; }
                    if (op[0] === 6 && _.label < t[1]) { _.label = t[1]; t = op; break; }
                    if (t && _.label < t[2]) { _.label = t[2]; _.ops.push(op); break; }
                    if (t[2]) _.ops.pop();
                    _.trys.pop(); continue;
            }
            op = body.call(thisArg, _);
        } catch (e) { op = [6, e]; y = 0; } finally { f = t = 0; }
        if (op[0] & 5) throw op[1]; return { value: op[0] ? op[1] : void 0, done: true };
    }
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.run = run;
var core = require("@actions/core");
var exec_1 = require("@actions/exec");
var fs = require("fs");
var path = require("path");
var artifact_1 = require("@actions/artifact");
var PathType;
(function (PathType) {
    PathType["URL"] = "URL";
    PathType["RELATIVE"] = "RELATIVE";
})(PathType || (PathType = {}));
function run() {
    return __awaiter(this, void 0, void 0, function () {
        var pathTypes, existingInstance, existingBundleId, projectId, instanceId, bundleId, setupResult, report, error_1;
        return __generator(this, function (_a) {
            switch (_a.label) {
                case 0:
                    _a.trys.push([0, 11, , 12]);
                    validateInputsAndEnv();
                    return [4 /*yield*/, getFilePathTypes()];
                case 1:
                    pathTypes = _a.sent();
                    return [4 /*yield*/, installCorelliumCli()];
                case 2:
                    _a.sent();
                    existingInstance = core.getInput('existingInstance');
                    existingBundleId = core.getInput('bundleId');
                    projectId = process.env.PROJECT;
                    instanceId = void 0;
                    bundleId = void 0;
                    if (!!existingInstance) return [3 /*break*/, 4];
                    return [4 /*yield*/, setupDevice(pathTypes)];
                case 3:
                    setupResult = _a.sent();
                    instanceId = setupResult.instanceId;
                    bundleId = setupResult.bundleId;
                    return [3 /*break*/, 6];
                case 4: return [4 /*yield*/, instanceCheck(existingInstance)];
                case 5:
                    _a.sent();
                    instanceId = existingInstance;
                    bundleId = existingBundleId;
                    _a.label = 6;
                case 6: return [4 /*yield*/, runMatrix(projectId, instanceId, bundleId, pathTypes)];
                case 7:
                    report = _a.sent();
                    if (!!existingInstance) return [3 /*break*/, 9];
                    return [4 /*yield*/, cleanup(instanceId)];
                case 8:
                    _a.sent();
                    _a.label = 9;
                case 9: return [4 /*yield*/, storeReportInArtifacts(report, bundleId)];
                case 10:
                    _a.sent();
                    return [3 /*break*/, 12];
                case 11:
                    error_1 = _a.sent();
                    if (error_1 instanceof Error) {
                        core.setFailed(error_1.message);
                    }
                    return [3 /*break*/, 12];
                case 12: return [2 /*return*/];
            }
        });
    });
}
function installCorelliumCli() {
    return __awaiter(this, void 0, void 0, function () {
        var error_2;
        return __generator(this, function (_a) {
            switch (_a.label) {
                case 0:
                    core.info('Installing Corellium-CLI...');
                    _a.label = 1;
                case 1:
                    _a.trys.push([1, 3, , 4]);
                    return [4 /*yield*/, execCmd('npm install -g @corellium/corellium-cli@1.3.2')];
                case 2:
                    _a.sent();
                    return [3 /*break*/, 4];
                case 3:
                    error_2 = _a.sent();
                    if (error_2 instanceof Error && error_2.message.includes('deprecated uuid')) {
                        core.warning('UUID deprecation warning encountered, but continuing as it is non-critical.');
                    }
                    else {
                        throw new Error("Error occurred executing npm install: ".concat(error_2 instanceof Error ? error_2.message : 'Unknown error'));
                    }
                    return [3 /*break*/, 4];
                case 4: return [2 /*return*/];
            }
        });
    });
}
function instanceCheck(instanceId) {
    return __awaiter(this, void 0, void 0, function () {
        var instanceDetails;
        return __generator(this, function (_a) {
            switch (_a.label) {
                case 0:
                    core.info('Connecting to Corellium...');
                    return [4 /*yield*/, execCmd("corellium login --endpoint ".concat(core.getInput('server'), " --apitoken ").concat(process.env.API_TOKEN))];
                case 1:
                    _a.sent();
                    core.info("Checking status of instance with ID: ".concat(instanceId, "..."));
                    return [4 /*yield*/, getInstanceStatus(instanceId)];
                case 2:
                    instanceDetails = _a.sent();
                    if (!(instanceDetails.state !== 'on')) return [3 /*break*/, 4];
                    core.info("Instance is not ready. Current status: ".concat(instanceDetails.state, ", Agent status: ").concat(instanceDetails.ready));
                    core.info('Starting instance...');
                    return [4 /*yield*/, execCmd("corellium instance start ".concat(instanceId))];
                case 3:
                    _a.sent();
                    _a.label = 4;
                case 4:
                    core.info('Waiting for instance to be ready...');
                    return [4 /*yield*/, pollInstanceStatus(instanceId)];
                case 5:
                    instanceDetails = _a.sent();
                    if (instanceDetails.ready) {
                        core.info('Instance is now ready.');
                    }
                    else {
                        throw new Error('Instance did not reach ready status.');
                    }
                    return [2 /*return*/];
            }
        });
    });
}
function getInstanceStatus(instanceId) {
    return __awaiter(this, void 0, void 0, function () {
        var apiOutput, error_3;
        return __generator(this, function (_a) {
            switch (_a.label) {
                case 0:
                    _a.trys.push([0, 2, , 3]);
                    core.info("Fetching status for instance ID: ".concat(instanceId, "..."));
                    return [4 /*yield*/, execCmd("corellium instance get --instance ".concat(instanceId))];
                case 1:
                    apiOutput = _a.sent();
                    return [2 /*return*/, JSON.parse(apiOutput)];
                case 2:
                    error_3 = _a.sent();
                    core.error("Error fetching instance status: ".concat(error_3 instanceof Error ? error_3.message : 'Unknown error'));
                    throw error_3;
                case 3: return [2 /*return*/];
            }
        });
    });
}
function pollInstanceStatus(instanceId) {
    return __awaiter(this, void 0, void 0, function () {
        var pollInterval, maxRetries, i, instanceDetails, error_4;
        return __generator(this, function (_a) {
            switch (_a.label) {
                case 0:
                    pollInterval = 30000;
                    maxRetries = 60;
                    i = 0;
                    _a.label = 1;
                case 1:
                    if (!(i < maxRetries)) return [3 /*break*/, 7];
                    _a.label = 2;
                case 2:
                    _a.trys.push([2, 5, , 6]);
                    return [4 /*yield*/, getInstanceReady(instanceId)];
                case 3:
                    instanceDetails = _a.sent();
                    if (instanceDetails.ready) {
                        return [2 /*return*/, instanceDetails];
                    }
                    core.info("Instance not ready yet. Retrying in ".concat(pollInterval / 1000, " seconds..."));
                    return [4 /*yield*/, new Promise(function (resolve) { return setTimeout(resolve, pollInterval); })];
                case 4:
                    _a.sent();
                    return [3 /*break*/, 6];
                case 5:
                    error_4 = _a.sent();
                    if (error_4 instanceof Error && error_4.message.includes("Agent not yet available")) {
                        return [3 /*break*/, 6];
                    }
                    else {
                        core.error("Error during polling: ".concat(error_4 instanceof Error ? error_4.message : 'Unknown error'));
                        throw error_4;
                    }
                    return [3 /*break*/, 6];
                case 6:
                    i++;
                    return [3 /*break*/, 1];
                case 7: throw new Error('Timed out waiting for instance to be ready.');
            }
        });
    });
}
function getInstanceReady(instanceId) {
    return __awaiter(this, void 0, void 0, function () {
        var projectId, apiOutput, error_5;
        return __generator(this, function (_a) {
            switch (_a.label) {
                case 0:
                    _a.trys.push([0, 2, , 3]);
                    projectId = process.env.PROJECT;
                    return [4 /*yield*/, execCmd("corellium instance ready --project ".concat(projectId, " --instance ").concat(instanceId))];
                case 1:
                    apiOutput = _a.sent();
                    return [2 /*return*/, JSON.parse(apiOutput)];
                case 2:
                    error_5 = _a.sent();
                    if (error_5 instanceof Error && !error_5.message.includes("Agent not yet available")) {
                        core.error("Error fetching readiness status: ".concat(error_5.message));
                    }
                    throw error_5;
                case 3: return [2 /*return*/];
            }
        });
    });
}
function setupDevice(pathTypes) {
    return __awaiter(this, void 0, void 0, function () {
        var projectId, resp, instanceId, appPath, instanceStr, instance, bundleId;
        return __generator(this, function (_a) {
            switch (_a.label) {
                case 0:
                    projectId = process.env.PROJECT;
                    core.info('Connecting to Corellium...');
                    return [4 /*yield*/, execCmd("corellium login --endpoint ".concat(core.getInput('server'), " --apitoken ").concat(process.env.API_TOKEN))];
                case 1:
                    _a.sent();
                    core.info('Creating device...');
                    return [4 /*yield*/, execCmd("corellium instance create ".concat(core.getInput('deviceFlavor'), " ").concat(core.getInput('deviceOS'), " ").concat(projectId, " --wait"))];
                case 2:
                    resp = _a.sent();
                    instanceId = resp.toString().trim();
                    core.info('Downloading app...');
                    return [4 /*yield*/, downloadFile('appFile', core.getInput('appPath'), pathTypes.appPath)];
                case 3:
                    appPath = _a.sent();
                    core.info("Installing app on ".concat(instanceId, "..."));
                    return [4 /*yield*/, execCmd("corellium apps install --project ".concat(projectId, " --instance ").concat(instanceId, " --app ").concat(appPath))];
                case 4:
                    _a.sent();
                    return [4 /*yield*/, execCmd("corellium instance get --instance ".concat(instanceId))];
                case 5:
                    instanceStr = _a.sent();
                    instance = tryJsonParse(instanceStr);
                    if (!((instance === null || instance === void 0 ? void 0 : instance.type) === 'ios')) return [3 /*break*/, 7];
                    core.info('Unlocking device...');
                    return [4 /*yield*/, execCmd("corellium instance unlock --instance ".concat(instanceId))];
                case 6:
                    _a.sent();
                    _a.label = 7;
                case 7: return [4 /*yield*/, getBundleId(instanceId)];
                case 8:
                    bundleId = _a.sent();
                    core.info("Opening ".concat(bundleId, " on ").concat(instanceId, "..."));
                    return [4 /*yield*/, execCmd("corellium apps open --project ".concat(projectId, " --instance ").concat(instanceId, " --bundle ").concat(bundleId))];
                case 9:
                    _a.sent();
                    return [2 /*return*/, { instanceId: instanceId, bundleId: bundleId }];
            }
        });
    });
}
function runMatrix(projectId, instanceId, bundleId, pathTypes) {
    return __awaiter(this, void 0, void 0, function () {
        var _a, wordlistId, inputInfo, inputsFilePath, inputsTimeout, instanceStr, instance, error_6, appPath, waitTime, assessmentId, createAssessment, resp, err_1;
        var _b;
        return __generator(this, function (_c) {
            switch (_c.label) {
                case 0: return [4 /*yield*/, Promise.all([
                        uploadWordlistFile(instanceId, pathTypes.keywords),
                        downloadInputFile(pathTypes.userActions),
                    ])];
                case 1:
                    _a = _c.sent(), wordlistId = _a[0], inputInfo = _a[1];
                    inputsFilePath = inputInfo.inputsFilePath;
                    inputsTimeout = inputInfo.inputsTimeout;
                    core.info('Running MATRIX...');
                    return [4 /*yield*/, execCmd("corellium instance get --instance ".concat(instanceId))];
                case 2:
                    instanceStr = _c.sent();
                    instance = tryJsonParse(instanceStr);
                    if (!((instance === null || instance === void 0 ? void 0 : instance.type) === 'ios')) return [3 /*break*/, 4];
                    core.info('Unlocking device...');
                    return [4 /*yield*/, execCmd("corellium instance unlock --instance ".concat(instanceId))];
                case 3:
                    _c.sent();
                    _c.label = 4;
                case 4:
                    core.info("Opening ".concat(bundleId, " on ").concat(instanceId, "..."));
                    _c.label = 5;
                case 5:
                    _c.trys.push([5, 7, , 14]);
                    return [4 /*yield*/, execCmd("corellium apps open --project ".concat(projectId, " --instance ").concat(instanceId, " --bundle ").concat(bundleId))];
                case 6:
                    _c.sent();
                    return [3 /*break*/, 14];
                case 7:
                    error_6 = _c.sent();
                    if (!(error_6 instanceof Error && error_6.message.includes('App not installed'))) return [3 /*break*/, 12];
                    core.info("App not installed. Installing the app...");
                    return [4 /*yield*/, downloadFile('appFile', core.getInput('appPath'), pathTypes.appPath)];
                case 8:
                    appPath = _c.sent();
                    return [4 /*yield*/, execCmd("corellium apps install --project ".concat(projectId, " --instance ").concat(instanceId, " --app ").concat(appPath))];
                case 9:
                    _c.sent();
                    waitTime = 120000;
                    core.info("Waiting ".concat(waitTime, "ms before retrying to open the app..."));
                    return [4 /*yield*/, wait(waitTime)];
                case 10:
                    _c.sent();
                    core.info('Retrying to open the app...');
                    return [4 /*yield*/, execCmd("corellium apps open --project ".concat(projectId, " --instance ").concat(instanceId, " --bundle ").concat(bundleId))];
                case 11:
                    _c.sent();
                    return [3 /*break*/, 13];
                case 12: throw error_6;
                case 13: return [3 /*break*/, 14];
                case 14:
                    core.info('Creating assessment...');
                    _c.label = 15;
                case 15:
                    _c.trys.push([15, 17, , 18]);
                    createAssessment = "corellium matrix create-assessment --instance ".concat(instanceId, " --bundle ").concat(bundleId);
                    if (wordlistId) {
                        createAssessment += " --wordlist ".concat(wordlistId);
                    }
                    return [4 /*yield*/, execCmd(createAssessment)];
                case 16:
                    resp = _c.sent();
                    assessmentId = (_b = tryJsonParse(resp)) === null || _b === void 0 ? void 0 : _b.id;
                    core.info("Created assessment ".concat(assessmentId, "..."));
                    return [3 /*break*/, 18];
                case 17:
                    err_1 = _c.sent();
                    throw new Error("Error creating MATRIX assessment! err=".concat(err_1));
                case 18: return [4 /*yield*/, pollAssessmentForStatus(assessmentId, instanceId, 'new')];
                case 19:
                    _c.sent();
                    core.info('Starting monitor...');
                    return [4 /*yield*/, execCmd("corellium matrix start-monitor --instance ".concat(instanceId, " --assessment ").concat(assessmentId))];
                case 20:
                    _c.sent();
                    return [4 /*yield*/, pollAssessmentForStatus(assessmentId, instanceId, 'monitoring')];
                case 21:
                    _c.sent();
                    core.info('Executing inputs on device...');
                    return [4 /*yield*/, execCmd("corellium input ".concat(instanceId, " ").concat(inputsFilePath))];
                case 22:
                    _c.sent();
                    core.info("Waiting ".concat(inputsTimeout, "ms for inputs to execute..."));
                    return [4 /*yield*/, wait(inputsTimeout)];
                case 23:
                    _c.sent();
                    core.info('Stopping monitor...');
                    return [4 /*yield*/, execCmd("corellium matrix stop-monitor --instance ".concat(instanceId, " --assessment ").concat(assessmentId))];
                case 24:
                    _c.sent();
                    return [4 /*yield*/, pollAssessmentForStatus(assessmentId, instanceId, 'readyForTesting')];
                case 25:
                    _c.sent();
                    core.info('Executing tests...');
                    return [4 /*yield*/, execCmd("corellium matrix test --instance ".concat(instanceId, " --assessment ").concat(assessmentId))];
                case 26:
                    _c.sent();
                    return [4 /*yield*/, pollAssessmentForStatus(assessmentId, instanceId, 'complete')];
                case 27:
                    _c.sent();
                    core.info('Downloading assessment...');
                    return [4 /*yield*/, execCmd("corellium matrix download-report --instance ".concat(instanceId, " --assessment ").concat(assessmentId))];
                case 28: return [2 /*return*/, _c.sent()];
            }
        });
    });
}
function cleanup(instanceId) {
    return __awaiter(this, void 0, void 0, function () {
        return __generator(this, function (_a) {
            switch (_a.label) {
                case 0:
                    core.info('Cleaning up...');
                    return [4 /*yield*/, execCmd("corellium instance stop ".concat(instanceId))];
                case 1:
                    _a.sent();
                    return [4 /*yield*/, execCmd("corellium instance delete ".concat(instanceId))];
                case 2:
                    _a.sent();
                    return [4 /*yield*/, execCmd("corellium logout")];
                case 3:
                    _a.sent();
                    return [2 /*return*/];
            }
        });
    });
}
function getBundleId(instanceId) {
    return __awaiter(this, void 0, void 0, function () {
        var resp, appList, bundleId;
        var _a;
        return __generator(this, function (_b) {
            switch (_b.label) {
                case 0: return [4 /*yield*/, execCmd("corellium apps --project ".concat(process.env.PROJECT, " --instance ").concat(instanceId))];
                case 1:
                    resp = _b.sent();
                    appList = tryJsonParse(resp);
                    bundleId = (_a = appList === null || appList === void 0 ? void 0 : appList.find(function (app) { return app.applicationType === 'User'; })) === null || _a === void 0 ? void 0 : _a.bundleID;
                    if (!bundleId) {
                        throw new Error('Error getting bundleId!');
                    }
                    return [2 /*return*/, bundleId];
            }
        });
    });
}
function uploadWordlistFile(instanceId, pathType) {
    return __awaiter(this, void 0, void 0, function () {
        var keywords, wordlistPath, resp, uploadedWordlistResp, wordlistId;
        return __generator(this, function (_a) {
            switch (_a.label) {
                case 0:
                    keywords = core.getInput('keywords');
                    if (!keywords) {
                        return [2 /*return*/, undefined];
                    }
                    core.info('Uploading wordlist...');
                    return [4 /*yield*/, downloadFile('wordlist.txt', keywords, pathType)];
                case 1:
                    wordlistPath = _a.sent();
                    return [4 /*yield*/, execCmd("corellium image create --project ".concat(process.env.PROJECT, " --instance ").concat(instanceId, " --format json wordlist.txt mast-wordlist plain ").concat(wordlistPath))];
                case 2:
                    resp = _a.sent();
                    uploadedWordlistResp = tryJsonParse(resp);
                    wordlistId = uploadedWordlistResp === null || uploadedWordlistResp === void 0 ? void 0 : uploadedWordlistResp[0].id;
                    core.info("Uploaded wordlist: ".concat(wordlistId));
                    return [2 /*return*/, wordlistId];
            }
        });
    });
}
function downloadInputFile(pathType) {
    return __awaiter(this, void 0, void 0, function () {
        var inputsFilePath, inputsJson, inputsTimeout;
        return __generator(this, function (_a) {
            switch (_a.label) {
                case 0: return [4 /*yield*/, downloadFile('inputs.json', core.getInput('userActions'), pathType)];
                case 1:
                    inputsFilePath = _a.sent();
                    inputsJson = JSON.parse(fs.readFileSync(inputsFilePath, 'utf-8'));
                    inputsTimeout = inputsJson.reduce(function (acc, curr) {
                        if (curr.wait) {
                            acc += curr.wait;
                        }
                        if (curr.duration) {
                            acc += curr.duration;
                        }
                        return acc;
                    }, 10000);
                    return [2 /*return*/, { inputsFilePath: inputsFilePath, inputsTimeout: inputsTimeout }];
            }
        });
    });
}
function pollAssessmentForStatus(assessmentId, instanceId, expectedStatus) {
    return __awaiter(this, void 0, void 0, function () {
        var getAssessmentStatus, actualStatus;
        var _this = this;
        return __generator(this, function (_a) {
            switch (_a.label) {
                case 0:
                    getAssessmentStatus = function () { return __awaiter(_this, void 0, void 0, function () {
                        var resp;
                        var _a;
                        return __generator(this, function (_b) {
                            switch (_b.label) {
                                case 0: return [4 /*yield*/, execCmd("corellium matrix get-assessment --instance ".concat(instanceId, " --assessment ").concat(assessmentId))];
                                case 1:
                                    resp = _b.sent();
                                    return [2 /*return*/, (_a = tryJsonParse(resp)) === null || _a === void 0 ? void 0 : _a.status];
                            }
                        });
                    }); };
                    return [4 /*yield*/, getAssessmentStatus()];
                case 1:
                    actualStatus = _a.sent();
                    _a.label = 2;
                case 2:
                    if (!(actualStatus !== expectedStatus)) return [3 /*break*/, 5];
                    return [4 /*yield*/, wait()];
                case 3:
                    _a.sent();
                    return [4 /*yield*/, getAssessmentStatus()];
                case 4:
                    actualStatus = _a.sent();
                    if (actualStatus === 'failed') {
                        throw new Error('MATRIX automated test failed!');
                    }
                    return [3 /*break*/, 2];
                case 5: return [2 /*return*/, actualStatus];
            }
        });
    });
}
function storeReportInArtifacts(report, bundleId) {
    return __awaiter(this, void 0, void 0, function () {
        var workspaceDir, reportFormat, reportFileName, reportPath, flavor, artifact, id, downloadPath;
        return __generator(this, function (_a) {
            switch (_a.label) {
                case 0:
                    workspaceDir = process.env.GITHUB_WORKSPACE;
                    reportFormat = core.getInput('reportFormat') || 'json';
                    reportFileName = "report.".concat(reportFormat);
                    reportPath = path.join(workspaceDir, reportFileName);
                    fs.writeFileSync(reportPath, report);
                    flavor = core.getInput('deviceFlavor');
                    artifact = new artifact_1.DefaultArtifactClient();
                    return [4 /*yield*/, artifact.uploadArtifact("matrix-report-".concat(flavor, "-").concat(bundleId), [reportPath], workspaceDir)];
                case 1:
                    id = (_a.sent()).id;
                    if (!id) {
                        throw new Error('Failed to upload MATRIX report artifact!');
                    }
                    return [4 /*yield*/, artifact.downloadArtifact(id)];
                case 2:
                    downloadPath = (_a.sent()).downloadPath;
                    core.setOutput('report', downloadPath);
                    return [2 /*return*/];
            }
        });
    });
}
function validateInputsAndEnv() {
    if (!process.env.API_TOKEN) {
        throw new Error('Environment secret missing: API_TOKEN');
    }
    if (!process.env.PROJECT) {
        throw new Error('Environment secret missing: PROJECT');
    }
    var requiredInputs = ['appPath', 'userActions'];
    requiredInputs.forEach(function (input) {
        var inputResp = core.getInput(input);
        if (!inputResp || typeof inputResp !== 'string' || inputResp === '') {
            throw new Error("Input required and not supplied: ".concat(input));
        }
    });
}
function downloadFile(fileNameToSave, pathValue, pathType) {
    return __awaiter(this, void 0, void 0, function () {
        var workspaceDir, downloadPath;
        return __generator(this, function (_a) {
            switch (_a.label) {
                case 0:
                    workspaceDir = process.env.GITHUB_WORKSPACE;
                    downloadPath = path.join(workspaceDir, fileNameToSave);
                    if (!(pathType === PathType.URL)) return [3 /*break*/, 2];
                    return [4 /*yield*/, (0, exec_1.exec)("curl -L -o ".concat(downloadPath, " ").concat(pathValue), [], { silent: true })];
                case 1:
                    _a.sent();
                    return [2 /*return*/, downloadPath];
                case 2: return [2 /*return*/, "".concat(workspaceDir).concat(pathValue.startsWith('/') ? pathValue : "/".concat(pathValue))];
            }
        });
    });
}
function wait() {
    return __awaiter(this, arguments, void 0, function (ms) {
        if (ms === void 0) { ms = 3000; }
        return __generator(this, function (_a) {
            return [2 /*return*/, new Promise(function (resolve) { return setTimeout(resolve, ms); })];
        });
    });
}
function execCmd(cmd) {
    return __awaiter(this, void 0, void 0, function () {
        var err, resp;
        return __generator(this, function (_a) {
            switch (_a.label) {
                case 0:
                    err = '';
                    resp = '';
                    return [4 /*yield*/, (0, exec_1.exec)(cmd, [], {
                            silent: true,
                            ignoreReturnCode: true,
                            listeners: {
                                stdout: function (data) {
                                    resp += data.toString();
                                },
                                stderr: function (data) {
                                    err += data.toString();
                                },
                            },
                        })];
                case 1:
                    _a.sent();
                    if (err) {
                        throw new Error("Error occurred executing ".concat(cmd, " err=").concat(err));
                    }
                    return [2 /*return*/, resp];
            }
        });
    });
}
function getFilePathTypes() {
    return __awaiter(this, void 0, void 0, function () {
        var pathInputs, workspaceDir, pathInputsWithTypes, _i, pathInputs_1, pathInput, filePath, _1, fullPath;
        return __generator(this, function (_a) {
            switch (_a.label) {
                case 0:
                    pathInputs = ['appPath', 'userActions', 'keywords'];
                    workspaceDir = process.env.GITHUB_WORKSPACE;
                    pathInputsWithTypes = {};
                    _i = 0, pathInputs_1 = pathInputs;
                    _a.label = 1;
                case 1:
                    if (!(_i < pathInputs_1.length)) return [3 /*break*/, 6];
                    pathInput = pathInputs_1[_i];
                    filePath = core.getInput(pathInput);
                    if (!filePath) return [3 /*break*/, 5];
                    _a.label = 2;
                case 2:
                    _a.trys.push([2, 3, , 5]);
                    new URL(filePath);
                    pathInputsWithTypes[pathInput] = PathType.URL;
                    return [3 /*break*/, 5];
                case 3:
                    _1 = _a.sent();
                    fullPath = "".concat(workspaceDir).concat(filePath.startsWith('/') ? filePath : "/".concat(filePath));
                    return [4 /*yield*/, fs.promises.stat(fullPath).catch(function () { return false; })];
                case 4:
                    if (_a.sent()) {
                        pathInputsWithTypes[pathInput] = PathType.RELATIVE;
                        return [3 /*break*/, 5];
                    }
                    throw new Error("Provided file path is invalid: ".concat(pathInput));
                case 5:
                    _i++;
                    return [3 /*break*/, 1];
                case 6: return [2 /*return*/, pathInputsWithTypes];
            }
        });
    });
}
function tryJsonParse(jsonStr) {
    try {
        return JSON.parse(jsonStr);
    }
    catch (_a) {
        return undefined;
    }
}
