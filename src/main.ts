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
    await installCorelliumCli(); // Now includes login
    const deviceId = core.getInput('deviceId');
    const existingBundleId = core.getInput('bundleId');
    const reportFormat = core.getInput('reportFormat') || 'json';
    const projectId = process.env.PROJECT as string;
    let instanceId: string;
    let bundleId: string;

    // Call setupDevice in both cases
    const setupResult = await setupDevice(pathTypes, deviceId, existingBundleId);
    instanceId = setupResult.instanceId;
    bundleId = setupResult.bundleId;
    if (!core.getInput('appPath') || !core.getInput('userActions')) {
      throw new Error('appPath and userActions are required inputs and not provided.');
    }    
    if (!bundleId) {
      throw new Error(`Bundle ID for instance ${instanceId} is missing.`); // This message should match the expected one in tests
    }    
    if (!deviceId) {
      await instanceCheck(instanceId);
    }
    const report = await runMatrix(projectId, instanceId, bundleId, reportFormat, pathTypes);
    if (!deviceId) {
      await cleanup(instanceId);
    } else {
      await execCmd(`corellium logout`);
    }    
    await storeReportInArtifacts(report, bundleId);
  } catch (error) {
    if (error instanceof Error) {
      if (error.message.includes('Assessment ID is missing')) {
        core.setFailed('Bundle ID does not exist');
      } else {
        core.setFailed(error.message);
      }
      throw error; // Re-throw the error to allow the test to catch it
    }
  }
}

/**
 * Installs the Corellium CLI and logs in.
 */
async function installCorelliumCli(): Promise<void> {
  core.info('Installing Corellium-CLI...');
  try {
    await execCmd('npm install -g @corellium/corellium-cli@latest');
    core.info('Logging into Corellium...');
    await execCmd(`corellium login --endpoint ${core.getInput('server')} --apitoken ${process.env.API_TOKEN}`);
  } catch (error) {
    if (error instanceof Error && error.message.includes('deprecated uuid')) {
      core.warning('UUID deprecation warning encountered, but continuing as it is non-critical.');
    } else {
      throw new Error(
        `Error occurred during installation or login: ${error instanceof Error ? error.message : 'Unknown error'}`,
      );
    }
  }
}

/**
 * Checks the status of the instance and ensures it is ready.
 * @param instanceId - The ID of the instance to check.
 */
export async function instanceCheck(instanceId: string): Promise<void> {
  core.info(`Checking status of instance with ID: ${instanceId}...`);
  const instanceDetails = await getInstanceStatus(instanceId);

  if (instanceDetails.state === 'off') {
    core.info(`Instance is not ready. Current status: ${instanceDetails.state}`);
    core.info('Starting instance...');
    await execCmd(`corellium instance start ${instanceId} --wait`);
  }

  core.info('Waiting for instance to be ready...');
  await waitForInstanceReady(instanceId);
}

/**
 * Retrieves the status of the specified instance.
 * @param instanceId - The ID of the instance.
 * @returns The instance details.
 */
export async function getInstanceStatus(instanceId: string): Promise<InstanceDetails> {
  core.info(`Fetching status for instance ID: ${instanceId}...`);
  
  // Execute the command to get instance details
  const apiOutput = await execCmd(`corellium instance get --instance ${instanceId}`).catch((err) => {
    core.warning(`Instance ID '${instanceId}' appears to be off or unreachable.`);
    return '';
  });
  if (!apiOutput) {
    throw new Error(`Instance ID '${instanceId}' is turned off.`);
  }  

  let instanceDetails: InstanceDetails;
  try {
    // Attempt to parse the JSON response
    instanceDetails = JSON.parse(apiOutput);
  } catch (parseError) {
    throw new Error(`Failed to parse instance details for ID '${instanceId}'.`);
  }

  return instanceDetails;
}

/**
 * Waits for the instance to be ready by polling its status.
 * @param instanceId - The ID of the instance.
 */
export async function waitForInstanceReady(instanceId: string): Promise<void> {
  const pollInterval = 30000; // Keep this as 30 seconds
  const maxRetries = 120; // Increase from 60 to 120 to allow more time

  for (let i = 0; i < maxRetries; i++) {
    try {
      const projectId = process.env.PROJECT as string;
      const apiOutput = await execCmd(`corellium instance ready --project ${projectId} --instance ${instanceId}`);
      const instanceDetails = JSON.parse(apiOutput) as InstanceDetails;

      if (instanceDetails.ready) {
        core.info('Instance is now ready.');
        return;
      }

      core.info(`Instance not ready yet. Retrying in ${pollInterval / 1000} seconds...`);
      await wait(pollInterval);
    } catch (error) {
      if (error instanceof Error && error.message.includes('Agent not yet available')) {
        core.info(`Agent not yet available. Retrying in ${pollInterval / 1000} seconds...`);
        await wait(pollInterval);
      } else {
        core.error(`Error during polling: ${error instanceof Error ? error.message : 'Unknown error'}`);
        throw error;
      }
    }
  }
  throw new Error('Timed out waiting for instance to be ready.');
}

/**
 * Sets up the device by creating or using an existing instance, installing the app, and opening it.
 * @param pathTypes - The types of the file paths.
 * @param deviceId - The ID of the existing device (if any).
 * @param existingBundleId - The bundle ID of the existing app (if any).
 * @returns The setup result containing instance and bundle IDs.
 */
export async function setupDevice(
  pathTypes: FilePathTypes,
  deviceId?: string,
  existingBundleId?: string,
): Promise<SetupResult> {
  const projectId = process.env.PROJECT as string;
  let instanceId: string;
  let bundleId: string;

  if (deviceId) {
    // Use existing instance
    instanceId = deviceId;
    await instanceCheck(instanceId);
  } else {
    // Create new device
    core.info('Creating device...');
    const resp = await execCmd(
      `corellium instance create ${core.getInput('deviceFlavor')} ${core.getInput('deviceOS')} ${projectId} --wait`,
    );
    instanceId = resp.toString().trim();
  }

  // Install app
  core.info('Downloading app...');
  const appPath = await downloadFile('appFile', core.getInput('appPath'), pathTypes.appPath);
  core.info(`Installing app on ${instanceId}...`);
  await execCmd(`corellium apps install --project ${projectId} --instance ${instanceId} --app ${appPath}`);

  // Unlock device if necessary
  const instanceStr = await execCmd(`corellium instance get --instance ${instanceId}`);
  const instance = tryJsonParse<Record<string, any>>(instanceStr);

  if (instance?.state === 'off') {
    core.info(`Instance ${instanceId} is off. Starting instance...`);
    await execCmd(`corellium instance start ${instanceId} --wait`);
  }

  if (instance?.type === 'ios') {
    core.info('Unlocking device...');
    await execCmd(`corellium instance unlock --instance ${instanceId}`);
  }

  // Get bundleId
  if (existingBundleId) {
    bundleId = existingBundleId;
} else {
    bundleId = await getBundleId(instanceId); // Ensure this function returns the correct bundle ID
}
  core.info(`Opening ${bundleId} on ${instanceId}...`);
  await execCmd(`corellium apps open --project ${projectId} --instance ${instanceId} --bundle ${bundleId}`);
  return { instanceId, bundleId };
}

/**
 * Runs the MATRIX assessment on the specified instance.
 * @param projectId - The project ID.
 * @param instanceId - The instance ID.
 * @param bundleId - The bundle ID of the app.
 * @param reportFormat - The desired report format.
 * @param pathTypes - The types of the file paths.
 * @returns The assessment report.
 */
export async function runMatrix(
  projectId: string,
  instanceId: string,
  bundleId: string,
  reportFormat: string,
  pathTypes: FilePathTypes,
): Promise<string> {
  const [wordlistId, inputInfo] = await Promise.all([
    uploadWordlistFile(instanceId, core.getInput('keywords'), pathTypes.keywords),
    downloadInputFile(core.getInput('userActions'), pathTypes.userActions),
  ]);

  const inputsFilePath = inputInfo.inputsFilePath;
  const inputsTimeout = inputInfo.inputsTimeout;

  core.info('Running MATRIX...');

  // The device should already be unlocked and the app opened in setupDevice

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
    if (err instanceof Error && err.message.includes('Assessment ID is missing')) {
      throw new Error(`Bundle ID '${bundleId}' does not exist.`);
    }
    throw new Error(`Error creating MATRIX assessment! err=${err instanceof Error ? err.message : 'Unknown error'}`);
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

/**
 * Cleans up by stopping and deleting the instance.
 * @param instanceId - The ID of the instance to clean up.
 */
export async function cleanup(instanceId: string): Promise<void> {
  core.info('Cleaning up...');
  await execCmd(`corellium instance stop ${instanceId}`);
  await execCmd(`corellium instance delete ${instanceId}`);
  await execCmd(`corellium logout`);
}

/**
 * Retrieves the bundle ID of the installed app on the instance.
 * @param instanceId - The ID of the instance.
 * @returns The bundle ID.
 */
export async function getBundleId(instanceId: string): Promise<string> {
  const resp = await execCmd(`corellium apps --project ${process.env.PROJECT} --instance ${instanceId}`);
  const appList = tryJsonParse<{ applicationType: string; bundleID: string }[]>(resp);

  if (!Array.isArray(appList)) {
    throw new Error(`Unable to retrieve application list for instance ID '${instanceId}'.`);
  }

  const bundleId = appList.find(app => app.applicationType === 'User')?.bundleID;
  if (!bundleId) {
    throw new Error(`Bundle ID for instance ${instanceId} is missing.`); // This message should match the expected one in tests
  }
  return bundleId; // Make sure this returns the correct ID  
}

/**
 * Uploads a wordlist file to the instance if provided.
 * @param instanceId - The ID of the instance.
 * @param pathValue - The path or URL to the wordlist file.
 * @param pathType - The type of the path (URL or relative).
 * @returns The ID of the uploaded wordlist image.
 */
export async function uploadWordlistFile(
  instanceId: string,
  pathValue?: string,
  pathType?: PathType,
): Promise<string | undefined> {
  if (!pathValue || !pathType) {
    return undefined;
  }
  core.info('Uploading wordlist...');
  const wordlistPath = await downloadFile('wordlist.txt', pathValue, pathType);
  const resp = await execCmd(
    `corellium image create --project ${process.env.PROJECT} --instance ${instanceId} --format json wordlist.txt mast-wordlist plain ${wordlistPath}`,
  );
  const uploadedWordlistResp = tryJsonParse<{ id: string }[]>(resp);
  const wordlistId = uploadedWordlistResp?.[0].id;
  core.info(`Uploaded wordlist: ${wordlistId}`);
  return wordlistId;
}

/**
 * Downloads the input file and calculates the total timeout needed for inputs to execute.
 * @param pathValue - The path or URL to the inputs file.
 * @param pathType - The type of the path (URL or relative).
 * @returns An object containing the inputs file path and timeout.
 */
export async function downloadInputFile(pathValue: string, pathType: PathType): Promise<InputInfo> {
  const inputsFilePath = await downloadFile('inputs.json', pathValue, pathType);
  const inputsJson = JSON.parse(readFileSync(inputsFilePath, 'utf-8'));
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

/**
 * Polls the assessment until it reaches the expected status.
 * @param assessmentId - The ID of the assessment.
 * @param instanceId - The ID of the instance.
 * @param expectedStatus - The expected status to wait for.
 * @returns The final status of the assessment.
 */
export async function pollAssessmentForStatus(
  assessmentId: string,
  instanceId: string,
  expectedStatus: string,
): Promise<string> {
  const maxRetries = 120; // Increase retries to 120
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

/**
 * Stores the MATRIX report as an artifact.
 * @param report - The report content.
 * @param bundleId - The bundle ID of the app.
 */
export async function storeReportInArtifacts(report: string, bundleId: string): Promise<void> {
  const workspaceDir = process.env.GITHUB_WORKSPACE as string;
  const reportFormat = core.getInput('reportFormat') || 'json';
  const reportFileName = `report.${reportFormat}`;
  const reportPath = path.join(workspaceDir, reportFileName);
  const dateTime = Date.now();
  writeFileSync(reportPath, report);
  const flavor = core.getInput('deviceFlavor');
  const artifact = new DefaultArtifactClient();

  const reportArtifactName = `matrix-report-${flavor}-${bundleId}-${dateTime}`;
  
  const { id } = await artifact.uploadArtifact(reportArtifactName, [reportPath], workspaceDir);
  if (!id) {
    throw new Error('Failed to upload MATRIX report artifact!');
  }
  const { downloadPath } = await artifact.downloadArtifact(id);
  core.setOutput('report', downloadPath);
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
    if (!deviceFlavor) {
      missingInputs.push('deviceFlavor');
    }
    if (!deviceOS) {
      missingInputs.push('deviceOS');
    }
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
 * Downloads a file from a URL or returns the local path if relative.
 * @param fileNameToSave - The name to save the file as.
 * @param pathValue - The path or URL to the file.
 * @param pathType - The type of the path (URL or relative).
 * @returns The path to the downloaded or local file.
 */
export async function downloadFile(fileNameToSave: string, pathValue: string, pathType: PathType): Promise<string> {
  const workspaceDir = process.env.GITHUB_WORKSPACE as string;
  const downloadPath = path.join(workspaceDir, fileNameToSave);
  if (pathType === PathType.URL) {
    await exec(`curl -L -o ${downloadPath} ${pathValue}`, [], { silent: true });
    return downloadPath;
  } else {
    const fullPath = path.resolve(workspaceDir, pathValue);
    return fullPath;
  }
}

/**
 * Waits for the specified amount of milliseconds.
 * @param ms - The number of milliseconds to wait.
 */
async function wait(ms = 3000): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Determines the types of the provided file paths (URL or relative).
 * @returns An object mapping input names to their path types.
 */
export async function getFilePathTypes(): Promise<FilePathTypes> {
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
        if (filePath) {
          const fullPath = path.resolve(workspaceDir, filePath);
          if (await promises.stat(fullPath).catch(() => false)) {
            pathInputsWithTypes[pathInput] = PathType.RELATIVE;
            continue;
          }
        }
        throw new Error(`Provided file path is invalid: ${pathInput}`);
      }
    }
  }
  return pathInputsWithTypes;
}

/**
 * Executes a command and returns the stdout output.
 * @param cmd - The command to execute.
 * @returns The standard output from the command.
 */
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
    throw new Error(`Error occurred executing ${cmd}: ${err}`);
  }
  return resp;
}

/**
 * Tries to parse a JSON string and returns the result.
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
