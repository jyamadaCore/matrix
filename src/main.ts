import * as core from '@actions/core';
import { exec } from '@actions/exec';
import { readFileSync, writeFileSync, promises } from 'fs';
import * as path from 'path';
import { DefaultArtifactClient } from '@actions/artifact';

/**
 * Enumeration for path types.
 */
export enum PathType {
  URL = 'url',
  RELATIVE = 'relative',
}

/**
 * Type definition for file path types.
 */
type FilePathTypes = Record<string, PathType>;

/**
 * Interface representing instance details.
 */
interface InstanceDetails {
  state: string;
  ready: boolean;
}

/**
 * Interface representing the setup result.
 */
interface SetupResult {
  instanceId: string;
  bundleId: string;
}

/**
 * Interface representing input information.
 */
interface InputInfo {
  inputsFilePath: string;
  inputsTimeout: number;
}

/**
 * Main function to execute the action.
 */
export async function run(): Promise<void> {
  try {
    validateInputsAndEnv();
    const pathTypes = await getFilePathTypes();
    await installCorelliumCli();

    const deviceId = core.getInput('deviceId');
    const existingBundleId = core.getInput('bundleId');
    const reportFormat = core.getInput('reportFormat') || 'json';
    const projectId = process.env.PROJECT as string;

    const { instanceId, bundleId } = await setupDevice(pathTypes, deviceId, existingBundleId);

    const report = await runMatrix(projectId, instanceId, bundleId, reportFormat, pathTypes);
    await storeReportInArtifacts(report, bundleId);

    if (!deviceId) {
      await cleanup(instanceId);
    } else {
      await execCmd('corellium logout');
    }
  } catch (error) {
    if (error instanceof Error) {
      core.setFailed(error.message.includes('Assessment ID is missing')
        ? 'Bundle ID does not exist'
        : error.message);
      throw error;
    }
  }
}

/**
 * Logs into Corellium using provided credentials.
 */
async function corelliumLogin(): Promise<void> {
  core.info('Logging into Corellium...');
  await execCmd(`corellium login --endpoint ${core.getInput('server')} --apitoken ${process.env.API_TOKEN}`);
}

/**
 * Installs the Corellium CLI and logs in.
 */
async function installCorelliumCli(): Promise<void> {
  core.info('Installing Corellium-CLI...');
  try {
    await execCmd('npm install -g @corellium/corellium-cli@latest');
    await corelliumLogin();
  } catch (error) {
    if (isErrorWithMessage(error) && error.message.includes('deprecated uuid')) {
      core.warning('UUID deprecation warning encountered, but continuing.');
    } else {
      const message = isErrorWithMessage(error) ? error.message : 'Unknown error';
      throw new Error(`CLI installation or login failed: ${message}`);
    }
  }
}

/**
 * Type guard to check if an error has a message property.
 */
function isErrorWithMessage(error: unknown): error is { message: string } {
  return typeof error === 'object' && error !== null && 'message' in error;
}

/**
 * Sets up the device by creating or using an existing instance, installs the app, and opens it.
 */
export async function setupDevice(
  pathTypes: FilePathTypes,
  deviceId?: string,
  existingBundleId?: string
): Promise<SetupResult> {
  let instanceId = deviceId || await createDevice();
  await prepareInstance(instanceId);

  const bundleId = existingBundleId || await getBundleId(instanceId);

  const appPath = await downloadFile('appFile', core.getInput('appPath'), pathTypes.appPath);
  await execCmd(`corellium apps install --instance ${instanceId} --app ${appPath}`);

  core.info(`Opening app ${bundleId} on instance ${instanceId}...`);
  await execCmd(`corellium apps open --instance ${instanceId} --bundle ${bundleId}`);

  return { instanceId, bundleId };
}

/**
 * Creates a new device instance.
 */
async function createDevice(): Promise<string> {
  await corelliumLogin();
  const resp = await execCmd(
    `corellium instance create ${core.getInput('deviceFlavor')} ${core.getInput('deviceOS')} ${process.env.PROJECT} --wait`
  );
  return resp.trim();
}

/**
 * Interface representing instance details.
 */
interface InstanceDetails {
  state: string;
  ready: boolean;
  type?: string; // Added optional 'type' property to avoid TypeScript error
}

/**
 * Prepares the instance by ensuring it is started and unlocked.
 */
async function prepareInstance(instanceId: string): Promise<void> {
  const status = await getInstanceStatus(instanceId);

  if (status.state === 'off') {
    core.info(`Instance ${instanceId} is off. Starting...`);
    await execCmd(`corellium instance start ${instanceId} --wait`);
  }

  // Check if the instance is an iOS device and ready
  if (status.ready && status.type === 'ios') {
    core.info(`Unlocking iOS device ${instanceId}...`);
    await execCmd(`corellium instance unlock --instance ${instanceId}`);
  }
}

/**
 * Polls the instance until it is ready, with adaptive retries.
 */
export async function waitForInstanceReady(instanceId: string): Promise<void> {
  const maxRetries = 10;
  let retryInterval = 5000;

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    const status = await getInstanceStatus(instanceId);

    if (status.ready) return;
    core.info(`Not ready. Retrying in ${retryInterval / 1000} seconds...`);
    await wait(retryInterval);
    retryInterval *= 2;
  }
  throw new Error(`Instance ${instanceId} not ready in time.`);
}

/**
 * Retrieves the instance status.
 */
async function getInstanceStatus(instanceId: string): Promise<InstanceDetails> {
  const output = await execCmd(`corellium instance get --instance ${instanceId}`);
  return JSON.parse(output);
}

/**
 * Runs the MATRIX assessment with adaptive polling.
 */
export async function runMatrix(
  projectId: string,
  instanceId: string,
  bundleId: string,
  reportFormat: string,
  pathTypes: FilePathTypes
): Promise<string> {
  const assessmentId = await createAssessment(instanceId, bundleId);

  await pollAssessmentForStatus(assessmentId, instanceId, 'complete');
  return await execCmd(
    `corellium matrix download-report --instance ${instanceId} --assessment ${assessmentId} --format ${reportFormat}`
  );
}

/**
 * Creates a MATRIX assessment.
 */
async function createAssessment(instanceId: string, bundleId: string): Promise<string> {
  const resp = await execCmd(`corellium matrix create-assessment --instance ${instanceId} --bundle ${bundleId}`);
  const result = JSON.parse(resp);
  return result.id;
}

/**
 * Polls for the assessment status.
 */
async function pollAssessmentForStatus(
  assessmentId: string,
  instanceId: string,
  expectedStatus: string
): Promise<void> {
  let retryInterval = 10000;

  for (let attempt = 0; attempt < 8; attempt++) {
    const status = await getAssessmentStatus(assessmentId, instanceId);

    if (status === expectedStatus) return;
    if (status === 'failed') throw new Error(`Assessment ${assessmentId} failed.`);

    core.info(`Status: ${status}. Retrying in ${retryInterval / 1000} seconds...`);
    await wait(retryInterval);
    retryInterval *= 2;
  }
  throw new Error(`Assessment ${assessmentId} did not reach ${expectedStatus} in time.`);
}

/**
 * Retrieves the assessment status.
 */
async function getAssessmentStatus(assessmentId: string, instanceId: string): Promise<string> {
  const resp = await execCmd(`corellium matrix get-assessment --instance ${instanceId} --assessment ${assessmentId}`);
  const { status } = JSON.parse(resp);
  return status;
}

/**
 * Downloads a file.
 */
async function downloadFile(fileName: string, pathValue: string, pathType: PathType): Promise<string> {
  const downloadPath = path.join(process.env.GITHUB_WORKSPACE as string, fileName);
  if (pathType === PathType.URL) await exec(`curl -L -o ${downloadPath} ${pathValue}`);
  return downloadPath;
}

/**
 * Stores the report as an artifact.
 */
export async function storeReportInArtifacts(report: string, bundleId: string): Promise<void> {
  const artifactClient = new DefaultArtifactClient();
  const reportPath = path.join(process.env.GITHUB_WORKSPACE as string, `report.json`);
  writeFileSync(reportPath, report);
  await artifactClient.uploadArtifact(`matrix-report-${bundleId}`, [reportPath], process.env.GITHUB_WORKSPACE!);
}

/**
 * Cleans up the instance.
 */
export async function cleanup(instanceId: string): Promise<void> {
  await execCmd(`corellium instance stop ${instanceId}`);
  await execCmd(`corellium instance delete ${instanceId}`);
}

/**
 * Utility to wait for a given duration.
 */
async function wait(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Retrieves the bundle ID of the installed app on the instance.
 * @param instanceId - The ID of the instance.
 * @returns The bundle ID.
 */
export async function getBundleId(instanceId: string): Promise<string> {
  const resp = await execCmd(`corellium apps --instance ${instanceId}`);
  const appList = tryJsonParse<{ applicationType: string; bundleID: string }[]>(resp);

  if (!Array.isArray(appList)) {
    throw new Error(`Unable to retrieve application list for instance ${instanceId}.`);
  }

  const bundleId = appList.find(app => app.applicationType === 'User')?.bundleID;
  if (!bundleId) {
    throw new Error(`Bundle ID for instance ${instanceId} is missing.`);
  }
  return bundleId;
}

/**
 * Validates the required inputs and environment variables.
 */
export function validateInputsAndEnv(): void {
  if (!process.env.API_TOKEN) {
    throw new Error('Environment secret missing: API_TOKEN');
  }
  if (!process.env.PROJECT) {
    throw new Error('Environment secret missing: PROJECT');
  }

  const requiredInputs = ['appPath', 'userActions'];
  const deviceId = core.getInput('deviceId');
  const deviceFlavor = core.getInput('deviceFlavor');
  const deviceOS = core.getInput('deviceOS');

  if (!deviceId) {
    const missingInputs = [];
    if (!deviceFlavor) missingInputs.push('deviceFlavor');
    if (!deviceOS) missingInputs.push('deviceOS');
    if (missingInputs.length > 0) {
      throw new Error(`Input required and not supplied: ${missingInputs.join(', ')}`);
    }
    requiredInputs.push('deviceFlavor', 'deviceOS');
  }

  requiredInputs.forEach(input => {
    const inputResp = core.getInput(input);
    if (!inputResp || typeof inputResp !== 'string' || inputResp.trim() === '') {
      throw new Error(`Input required and not supplied: ${input}`);
    }
  });
}

/**
 * Determines the types of provided file paths (URL or relative).
 * @returns An object mapping input names to their path types.
 */
export async function getFilePathTypes(): Promise<FilePathTypes> {
  const pathInputs = ['appPath', 'userActions', 'keywords'];
  const workspaceDir = process.env.GITHUB_WORKSPACE as string;
  const pathTypes: FilePathTypes = {};

  for (const pathInput of pathInputs) {
    const filePath = core.getInput(pathInput);
    if (filePath) {
      try {
        new URL(filePath);
        pathTypes[pathInput] = PathType.URL;
      } catch {
        const resolvedPath = path.resolve(workspaceDir, filePath);
        if (await promises.stat(resolvedPath).catch(() => false)) {
          pathTypes[pathInput] = PathType.RELATIVE;
        } else {
          throw new Error(`Invalid path: ${pathInput}`);
        }
      }
    }
  }
  return pathTypes;
}

/**
 * Executes a shell command and returns the output.
 * @param cmd - The command to execute.
 * @returns The standard output.
 */
async function execCmd(cmd: string): Promise<string> {
  let output = '';
  let errorOutput = '';

  await exec(cmd, [], {
    silent: true,
    ignoreReturnCode: true,
    listeners: {
      stdout: (data: Buffer) => {
        output += data.toString();
      },
      stderr: (data: Buffer) => {
        errorOutput += data.toString();
      },
    },
  });

  if (errorOutput) {
    throw new Error(`Command "${cmd}" failed: ${errorOutput}`);
  }
  return output;
}

/**
 * Safely parses a JSON string.
 * @param jsonStr - The JSON string to parse.
 * @returns The parsed JSON object or undefined if parsing fails.
 */
function tryJsonParse<T>(jsonStr: string): T | undefined {
  try {
    return JSON.parse(jsonStr) as T;
  } catch {
    return undefined;
  }
}
