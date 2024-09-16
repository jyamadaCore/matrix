import * as core from '@actions/core';
import { exec } from '@actions/exec';
import * as fs from 'fs';
import * as path from 'path';
import { DefaultArtifactClient } from '@actions/artifact';

enum PathType {
  URL = 'URL',
  RELATIVE = 'RELATIVE',
}

interface InstanceDetails {
  state: string;
  ready: boolean;
}

interface SetupResult {
  instanceId: string;
  bundleId: string;
}

interface InputInfo {
  inputsFilePath: string;
  inputsTimeout: number;
}

interface AssessmentStatus {
  status: string;
}

export async function getFilePathTypes(): Promise<Record<string, PathType>> {
  const pathInputs = ['appPath', 'userActions', 'keywords'];
  const workspaceDir = process.env.GITHUB_WORKSPACE as string;
  const pathInputsWithTypes: Record<string, PathType> = {};

  for (const pathInput of pathInputs) {
    const filePath = core.getInput(pathInput);
    if (filePath) {
      try {
        new URL(filePath);
        pathInputsWithTypes[pathInput] = PathType.URL;
        continue;
      } catch (_) {
        const fullPath = `${workspaceDir}${filePath.startsWith('/') ? filePath : `/${filePath}`}`;
        if (await fs.promises.stat(fullPath).catch(() => false)) {
          pathInputsWithTypes[pathInput] = PathType.RELATIVE;
          continue;
        }
        throw new Error(`Provided file path is invalid: ${pathInput}`);
      }
    }
  }

  return pathInputsWithTypes;
}

export async function run(): Promise<void> {
  try {
    validateInputsAndEnv();
    const pathTypes = await getFilePathTypes();
    await installCorelliumCli();
    const existingInstance = core.getInput('existingInstance');
    const existingBundleId = core.getInput('bundleId');
    const reportFormat = core.getInput('reportFormat');
    const projectId = process.env.PROJECT as string;
    let instanceId: string;
    let bundleId: string;

    if (!existingInstance) {
      const setupResult = await setupDevice(pathTypes);
      instanceId = setupResult.instanceId;
      bundleId = setupResult.bundleId;
    } else {
      await instanceCheck(existingInstance);
      instanceId = existingInstance;
      bundleId = existingBundleId;
    }

    const report = await runMatrix(projectId, instanceId, bundleId, reportFormat, pathTypes);
    if (!existingInstance) {
      await cleanup(instanceId);
    }
    await storeReportInArtifacts(report, bundleId);
  } catch (error) {
    if (error instanceof Error) {
      core.setFailed(error.message);
    }
  }
}

async function installCorelliumCli(): Promise<void> {
  core.info('Installing Corellium-CLI...');
  try {
    await execCmd('npm install -g @corellium/corellium-cli@1.3.2');
  } catch (error) {
    if (error instanceof Error && error.message.includes('deprecated uuid')) {
      core.warning('UUID deprecation warning encountered, but continuing as it is non-critical.');
    } else {
      throw new Error(
        `Error occurred executing npm install: ${error instanceof Error ? error.message : 'Unknown error'}`,
      );
    }
  }
}

async function instanceCheck(instanceId: string): Promise<void> {
  core.info('Connecting to Corellium...');
  await execCmd(`corellium login --endpoint ${core.getInput('server')} --apitoken ${process.env.API_TOKEN}`);
  core.info(`Checking status of instance with ID: ${instanceId}...`);
  let instanceDetails = await getInstanceStatus(instanceId);

  if (instanceDetails.state !== 'on') {
    core.info(
      `Instance is not ready. Current status: ${instanceDetails.state}, Agent status: ${instanceDetails.ready}`,
    );
    core.info('Starting instance...');
    await execCmd(`corellium instance start ${instanceId}`);
  }

  core.info('Waiting for instance to be ready...');
  instanceDetails = await pollInstanceStatus(instanceId);
  if (instanceDetails.ready) {
    core.info('Instance is now ready.');
  } else {
    throw new Error('Instance did not reach ready status.');
  }
}

async function getInstanceStatus(instanceId: string): Promise<InstanceDetails> {
  try {
    core.info(`Fetching status for instance ID: ${instanceId}...`);
    const apiOutput = await execCmd(`corellium instance get --instance ${instanceId}`);
    return JSON.parse(apiOutput);
  } catch (error) {
    core.error(`Error fetching instance status: ${error instanceof Error ? error.message : 'Unknown error'}`);
    throw error;
  }
}

async function pollInstanceStatus(instanceId: string): Promise<InstanceDetails> {
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
    } catch (error) {
      if (error instanceof Error && error.message.includes('Agent not yet available')) {
        continue;
      } else {
        core.error(`Error during polling: ${error instanceof Error ? error.message : 'Unknown error'}`);
        throw error;
      }
    }
  }
  throw new Error('Timed out waiting for instance to be ready.');
}

async function getInstanceReady(instanceId: string): Promise<InstanceDetails> {
  try {
    const projectId = process.env.PROJECT as string;
    const apiOutput = await execCmd(`corellium instance ready --project ${projectId} --instance ${instanceId}`);
    return JSON.parse(apiOutput);
  } catch (error) {
    if (error instanceof Error && !error.message.includes('Agent not yet available')) {
      core.error(`Error fetching readiness status: ${error.message}`);
    }
    throw error;
  }
}

async function setupDevice(pathTypes: Record<string, PathType>): Promise<SetupResult> {
  const projectId = process.env.PROJECT as string;
  core.info('Connecting to Corellium...');
  await execCmd(`corellium login --endpoint ${core.getInput('server')} --apitoken ${process.env.API_TOKEN}`);
  core.info('Creating device...');
  const resp = await execCmd(
    `corellium instance create ${core.getInput('deviceFlavor')} ${core.getInput('deviceOS')} ${projectId} --wait`,
  );
  const instanceId = resp.toString().trim();
  core.info('Downloading app...');
  const appPath = await downloadFile('appFile', core.getInput('appPath'), pathTypes.appPath);
  core.info(`Installing app on ${instanceId}...`);
  await execCmd(`corellium apps install --project ${projectId} --instance ${instanceId} --app ${appPath}`);
  const instanceStr = await execCmd(`corellium instance get --instance ${instanceId}`);
  const instance = tryJsonParse<Record<string, any>>(instanceStr);

  if (instance?.type === 'ios') {
    core.info('Unlocking device...');
    await execCmd(`corellium instance unlock --instance ${instanceId}`);
  }

  const bundleId = await getBundleId(instanceId);
  core.info(`Opening ${bundleId} on ${instanceId}...`);
  await execCmd(`corellium apps open --project ${projectId} --instance ${instanceId} --bundle ${bundleId}`);
  return { instanceId, bundleId };
}

async function runMatrix(
  projectId: string,
  instanceId: string,
  bundleId: string,
  reportFormat: string,
  pathTypes: Record<string, PathType>,
): Promise<string> {
  const [wordlistId, inputInfo] = await Promise.all([
    uploadWordlistFile(instanceId, pathTypes.keywords),
    downloadInputFile(pathTypes.userActions),
  ]);

  const inputsFilePath = inputInfo.inputsFilePath;
  const inputsTimeout = inputInfo.inputsTimeout;

  core.info('Running MATRIX...');
  const instanceStr = await execCmd(`corellium instance get --instance ${instanceId}`);
  const instance = tryJsonParse<Record<string, any>>(instanceStr);

  if (instance?.type === 'ios') {
    core.info('Unlocking device...');
    await execCmd(`corellium instance unlock --instance ${instanceId}`);
  }

  core.info(`Opening ${bundleId} on ${instanceId}...`);
  try {
    await execCmd(`corellium apps open --project ${projectId} --instance ${instanceId} --bundle ${bundleId}`);
  } catch (error) {
    if (error instanceof Error && error.message.includes('App not installed')) {
      core.info(`App not installed. Installing the app...`);
      const appPath = await downloadFile('appFile', core.getInput('appPath'), pathTypes.appPath);
      await execCmd(`corellium apps install --project ${projectId} --instance ${instanceId} --app ${appPath}`);
      const waitTime = 140000;
      core.info(`Waiting ${waitTime}ms before retrying to open the app...`);
      await wait(waitTime);
      core.info('Retrying to open the app...');
      await execCmd(`corellium apps open --project ${projectId} --instance ${instanceId} --bundle ${bundleId}`);
    } else {
      throw error;
    }
  }

  core.info('Creating assessment...');
  let assessmentId: string;
  try {
    let createAssessment = `corellium matrix create-assessment --instance ${instanceId} --bundle ${bundleId}`;
    if (wordlistId) {
      createAssessment += ` --wordlist ${wordlistId}`;
    }
    const resp = await execCmd(createAssessment);
    const parsedResponse = tryJsonParse<{ id: string }>(resp);
    if (!parsedResponse || !parsedResponse.id) {
      throw new Error('Assessment ID is missing from the response');
    }
    assessmentId = parsedResponse.id;
    core.info(`Created assessment ${assessmentId}...`);
  } catch (err) {
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
  return await execCmd(
    `corellium matrix download-report --instance ${instanceId} --assessment ${assessmentId} --format ${reportFormat}`,
  );
}

async function cleanup(instanceId: string): Promise<void> {
  core.info('Cleaning up...');
  await execCmd(`corellium instance stop ${instanceId}`);
  await execCmd(`corellium instance delete ${instanceId}`);
  await execCmd(`corellium logout`);
}

async function getBundleId(instanceId: string): Promise<string> {
  const resp = await execCmd(`corellium apps --project ${process.env.PROJECT} --instance ${instanceId}`);
  const appList = tryJsonParse<{ applicationType: string; bundleID: string }[]>(resp);
  const bundleId = appList?.find(app => app.applicationType === 'User')?.bundleID;
  if (!bundleId) {
    throw new Error('Error getting bundleId!');
  }
  return bundleId;
}

async function uploadWordlistFile(instanceId: string, pathType: PathType): Promise<string | undefined> {
  const keywords = core.getInput('keywords');
  if (!keywords) {
    return undefined;
  }
  core.info('Uploading wordlist...');
  const wordlistPath = await downloadFile('wordlist.txt', keywords, pathType);
  const resp = await execCmd(
    `corellium image create --project ${process.env.PROJECT} --instance ${instanceId} --format json wordlist.txt mast-wordlist plain ${wordlistPath}`,
  );
  const uploadedWordlistResp = tryJsonParse<{ id: string }[]>(resp);
  const wordlistId = uploadedWordlistResp?.[0].id;
  core.info(`Uploaded wordlist: ${wordlistId}`);
  return wordlistId;
}

async function downloadInputFile(pathType: PathType): Promise<InputInfo> {
  const inputsFilePath = await downloadFile('inputs.json', core.getInput('userActions'), pathType);
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
  instanceId: string,
  expectedStatus: string,
): Promise<string> {
  const getAssessmentStatus = async (): Promise<string> => {
    const resp = await execCmd(`corellium matrix get-assessment --instance ${instanceId} --assessment ${assessmentId}`);
    const parsedStatus = tryJsonParse<{ status: string }>(resp);
    if (!parsedStatus || !parsedStatus.status) {
      throw new Error('Status is missing from the response');
    }
    return parsedStatus.status;
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

async function storeReportInArtifacts(report: string, bundleId: string): Promise<void> {
  const workspaceDir = process.env.GITHUB_WORKSPACE as string;
  const reportFormat = core.getInput('reportFormat') || 'json';
  const reportFileName = `report.${reportFormat}`;
  const reportPath = path.join(workspaceDir, reportFileName);
  const dateTime = Date.now();
  fs.writeFileSync(reportPath, report);
  const flavor = core.getInput('deviceFlavor');
  const artifact = new DefaultArtifactClient();
  const { id } = await artifact.uploadArtifact(
    `matrix-report-${flavor}-${bundleId}-${dateTime}`,
    [reportPath],
    workspaceDir,
  );
  if (!id) {
    throw new Error('Failed to upload MATRIX report artifact!');
  }
  const { downloadPath } = await artifact.downloadArtifact(id);
  core.setOutput('report', downloadPath);
}

function validateInputsAndEnv(): void {
  if (!process.env.API_TOKEN) {
    throw new Error('Environment secret missing: API_TOKEN');
  }
  if (!process.env.PROJECT) {
    throw new Error('Environment secret missing: PROJECT');
  }
  const requiredInputs = ['appPath', 'userActions'];
  requiredInputs.forEach(input => {
    const inputResp = core.getInput(input);
    if (!inputResp || typeof inputResp !== 'string' || inputResp === '') {
      throw new Error(`Input required and not supplied: ${input}`);
    }
  });
}

async function downloadFile(fileNameToSave: string, pathValue: string, pathType: PathType): Promise<string> {
  const workspaceDir = process.env.GITHUB_WORKSPACE as string;
  const downloadPath = path.join(workspaceDir, fileNameToSave);
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
        resp += data.toString();
      },
      stderr: (data: Buffer) => {
        err += data.toString();
      },
    },
  });
  if (err) {
    throw new Error(`Error occurred executing ${cmd} err=${err}`);
  }
  return resp;
}

function tryJsonParse<T>(jsonStr: string): T | undefined {
  try {
    return JSON.parse(jsonStr) as T;
  } catch {
    return undefined;
  }
}
