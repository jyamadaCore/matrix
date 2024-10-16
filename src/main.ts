import * as core from '@actions/core';
import { exec } from '@actions/exec';
import { DefaultArtifactClient } from '@actions/artifact';
import * as path from 'path';
import fs from 'fs';

enum PathType {
  URL = 'url',
  RELATIVE = 'relative',
}
type FilePathTypes = Record<string, PathType>;

/**
 * The main function for the action.
 * @returns {Promise<void>} Resolves when the action is complete.
 */
export async function run(): Promise<void> {
  try {
    validateInputsAndEnv();
    const pathTypes = await getFilePathTypes();
    await installCorelliumCli();
    
    const deviceId = core.getInput('deviceId');
    const reportFormat = core.getInput('reportFormat') || 'html';
    let finalInstanceId: string;
    let bundleId: string;
    let isNewInstance = false;

    core.info(`Received deviceId: ${deviceId}`);
    core.info(`Received reportFormat: ${reportFormat}`);

    if (deviceId && deviceId.trim() !== '') {
      finalInstanceId = deviceId.trim();
    } else {
      ({ deviceId: finalInstanceId } = await setupDevice());
      isNewInstance = true;
    }

    bundleId = await setupApp(finalInstanceId, pathTypes);
    
    const report = await runMatrix(finalInstanceId, bundleId, pathTypes);
    
    if (isNewInstance) {
      await cleanup(finalInstanceId);
    }
    
    await storeReportInArtifacts(report, bundleId, reportFormat);
  } catch (error) {
    // Fail the workflow run if an error occurs
    if (error instanceof Error) {
      core.setFailed(error.message);
    }
  }
}

async function installCorelliumCli(): Promise<void> {
  core.info('Installing Corellium-CLI...');
  await exec('npm install -g @corellium/corellium-cli@1.3.2');
  await execCmd(`corellium login --endpoint ${core.getInput('server')} --apitoken ${process.env.CORELLIUM_API_TOKEN
}`);
}

async function setupDevice(): Promise<{ deviceId: string }> {
  const projectId = process.env.PROJECT;

  core.info('Creating device...');
  const resp = await execCmd(
    `corellium instance create ${core.getInput('deviceFlavor')} ${core.getInput('deviceOS')} ${projectId} --wait`,
  );
  const deviceId = resp?.toString().trim();
  return { deviceId };
}

async function setupApp(deviceId: string, pathTypes: FilePathTypes): Promise<string> {
  const projectId = process.env.PROJECT;

  core.info('Downloading app...');
  const appPath = await downloadFile('appFile', core.getInput('appPath'), pathTypes.appPath);

  core.info(`Installing app on ${deviceId}...`);
  await execCmd(`corellium apps install --project ${projectId} --instance ${deviceId} --app ${appPath}`);

  const instanceStr = await execCmd(`corellium instance get --instance ${deviceId}`);
  const instance = tryJsonParse(instanceStr) as unknown as { type: string };
  if (instance?.type === 'ios') {
    core.info('Unlocking device...');
    await execCmd(`corellium instance unlock --instance ${deviceId}`);
  }

  const bundleId = await getBundleId(deviceId);

  core.info(`Opening ${bundleId} on ${deviceId}...`);
  await execCmd(`corellium apps open --project ${projectId} --instance ${deviceId} --bundle ${bundleId}`);

  return bundleId;
}

async function runMatrix(deviceId: string, bundleId: string, pathTypes: FilePathTypes): Promise<string> {
  const [wordlistId, inputInfo] = await Promise.all([
    uploadWordlistFile(deviceId, pathTypes.keywords),
    downloadInputFile(pathTypes.userActions),
  ]);
  const inputsFilePath = inputInfo.inputsFilePath;
  const inputsTimeout = inputInfo.inputsTimeout;

  core.info('Running MATRIX...');

  core.info('Creating assessment...');
  let assessmentId: string | undefined;
  try {
    let createAssessment = `corellium matrix create-assessment --instance ${deviceId} --bundle ${bundleId}`;
    if (wordlistId) {
      createAssessment += ` --wordlist ${wordlistId}`;
    }
    const resp = await execCmd(createAssessment);
    assessmentId = (tryJsonParse(resp) as { id: string })?.id;
    core.info(`Created assessment ${assessmentId}...`);
  } catch (err) {
    throw new Error(`Error creating MATRIX assessment! err=${err}`);
  }

  await pollAssessmentForStatus(assessmentId, deviceId, 'new');
  core.info('Starting monitor...');
  await execCmd(`corellium matrix start-monitor --instance ${deviceId} --assessment ${assessmentId}`);

  await pollAssessmentForStatus(assessmentId, deviceId, 'monitoring');
  core.info('Executing inputs on device...');
  await execCmd(`corellium input ${deviceId} ${inputsFilePath}`);
  core.info(`Waiting ${inputsTimeout}ms for inputs to execute...`);
  await wait(inputsTimeout);

  core.info('Stopping monitor...');
  await execCmd(`corellium matrix stop-monitor --instance ${deviceId} --assessment ${assessmentId}`);

  await pollAssessmentForStatus(assessmentId, deviceId, 'readyForTesting');
  core.info('Executing tests...');
  await execCmd(`corellium matrix test --instance ${deviceId} --assessment ${assessmentId}`);

  await pollAssessmentForStatus(assessmentId, deviceId, 'complete');
  core.info('Downloading assessment...');
  return await execCmd(`corellium matrix download-report --instance ${deviceId} --assessment ${assessmentId}`);
}

async function cleanup(deviceId: string): Promise<void> {
  core.info('Cleaning up...');
  await execCmd(`corellium instance stop ${deviceId}`);
  await execCmd(`corellium instance delete ${deviceId}`);
  await execCmd(`corellium logout`);
}

async function getBundleId(deviceId: string): Promise<string> {
  const resp = await execCmd(`corellium apps --project ${process.env.PROJECT} --instance ${deviceId}`);
  const appList = tryJsonParse(resp) as unknown as { applicationType: string; bundleID: string }[];
  const bundleId = appList?.find(app => app.applicationType === 'User')?.bundleID;
  if (!bundleId) {
    throw new Error('Error getting bundleId!');
  }
  return bundleId;
}

async function uploadWordlistFile(deviceId: string, pathType: PathType): Promise<string | undefined> {
  const keywords = core.getInput('keywords');
  if (!keywords) {
    return;
  }

  core.info('Uploading wordlist...');
  const wordlistPath = await downloadFile('wordlist.txt', keywords, pathType);
  const resp = await execCmd(
    `corellium image create --project ${process.env.PROJECT} --instance ${deviceId} --format json wordlist.txt mast-wordlist plain ${wordlistPath}`,
  );
  const uploadedWordlistResp = tryJsonParse(resp) as unknown as { id: string }[];
  const wordlistId = uploadedWordlistResp?.[0].id;
  core.info(`Uploaded wordlist: ${wordlistId}`);
  return wordlistId;
}

async function downloadInputFile(pathType: PathType): Promise<{ inputsFilePath: string; inputsTimeout: number }> {
  const inputsFilePath = await downloadFile('inputs.json', core.getInput('userActions'), pathType);

  // estimating time it takes to execute device inputs - has 10s buffer
  const inputsJson = JSON.parse(fs.readFileSync(inputsFilePath, 'utf-8'));
  const inputsTimeout = inputsJson.reduce((acc: number, curr: { wait?: number; duration?: number }) => {
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

export async function pollAssessmentForStatus(
  assessmentId: string,
  deviceId: string,
  expectedStatus: string,
): Promise<string> {
  const getAssessmentStatus = async (): Promise<string> => {
    const resp = await execCmd(`corellium matrix get-assessment --instance ${deviceId} --assessment ${assessmentId}`);
    return (tryJsonParse(resp) as { status: string })?.status;
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

async function storeReportInArtifacts(report: string, bundleId: string, reportFormat: string): Promise<void> {
  const workspaceDir = process.env.GITHUB_WORKSPACE as string;
  const reportPath = path.join(workspaceDir, `report.${reportFormat}`);
  fs.writeFileSync(reportPath, report);
  const flavor = core.getInput('deviceFlavor');

  const artifact = new DefaultArtifactClient();

  const { id } = await artifact.uploadArtifact(`matrix-report-${flavor}-${bundleId}`, [reportPath], workspaceDir);
  if (!id) {
    throw new Error('Failed to upload MATRIX report artifact!');
  }

  const { downloadPath } = await artifact.downloadArtifact(id);

  core.setOutput('report', downloadPath);
}

function validateInputsAndEnv(): void {
  if (!process.env.CORELLIUM_API_TOKEN
  ) {
    throw new Error('Environment secret missing: CORELLIUM_API_TOKEN');
  }
  if (!process.env.PROJECT) {
    throw new Error('Environment secret missing: PROJECT');
  }

  // inputs from action file are not validated https://github.com/actions/runner/issues/1070
  const requiredInputs = ['deviceFlavor', 'deviceOS', 'appPath', 'userActions', 'reportFormat'];
  requiredInputs.forEach((input: string) => {
    const inputResp = core.getInput(input);
    if (!inputResp || typeof inputResp !== 'string' || inputResp === '') {
      throw new Error(`Input required and not supplied: ${input}`);
    }
  });
}

async function downloadFile(fileNameToSave: string, pathValue: string, pathType: PathType): Promise<string> {
  const workspaceDir = process.env.GITHUB_WORKSPACE as string;
  const downloadPath = path.join(workspaceDir, fileNameToSave);

  // download file from URL, otherwise already on github workspace
  if (pathType === PathType.URL) {
    await exec(`curl -L -o ${downloadPath} ${pathValue}`, [], { silent: true });
    return downloadPath;
  } else {
    return `${workspaceDir}${pathValue.startsWith('/') ? pathValue : `/${pathValue}`}`;
  }
}

async function wait(ms = 3000): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function execCmd(cmd: string): Promise<string> {
  let err = '';
  let resp = '';

  await exec(cmd, [], {
    silent: true,
    ignoreReturnCode: true,
    listeners: {
      stdout: (data: Buffer) => {
        resp += data;
      },
      stderr: (data: Buffer) => {
        err += data.toString();
      },
    },
  });
  if (err) {
    throw new Error(`Error occurred executing ${cmd}! err=${err}`);
  }
  return resp;
}

export async function getFilePathTypes(): Promise<FilePathTypes> {
  // these can be either URLs or file relative to the github workspace
  const pathInputs = ['appPath', 'userActions', 'keywords'];

  const workspaceDir = process.env.GITHUB_WORKSPACE as string;

  const pathInputsWithTypes: FilePathTypes = {};
  for (const pathInput of pathInputs) {
    const filePath = core.getInput(pathInput);
    if (filePath) {
      try {
        new URL(filePath);
        pathInputsWithTypes[pathInput] = PathType.URL;
        continue;
      } catch (_) {
        if (
          !!(await fs.promises
            .stat(`${workspaceDir}${filePath.startsWith('/') ? filePath : `/${filePath}`}`)
            .catch(() => false))
        ) {
          pathInputsWithTypes[pathInput] = PathType.RELATIVE;
          continue;
        }

        throw new Error(`Provided file path is invalid: ${pathInput}`);
      }
    }
  }
  return pathInputsWithTypes;
}

function tryJsonParse(jsonStr: string): Record<string, unknown> | undefined {
  let obj = undefined;

  if (jsonStr && typeof jsonStr === 'string' && jsonStr !== '') {
    try {
      obj = JSON.parse(jsonStr);
    } catch (err) {
      // do nothing
    }
  }

  return obj;
}
