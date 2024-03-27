import * as core from '@actions/core';
import { exec } from '@actions/exec';
import { DefaultArtifactClient } from '@actions/artifact';
import * as path from 'path';
import fs from 'fs';

/**
 * The main function for the action.
 * @returns {Promise<void>} Resolves when the action is complete.
 */
export async function run(): Promise<void> {
  try {
    validateInputsAndVars();
    await installCorelliumCli();
    const instanceId = await setupDevice();
    const report = await runMatrix(instanceId);
    await cleanup(instanceId);
    await storeReportInArtifacts(report);
  } catch (error) {
    // Fail the workflow run if an error occurs
    if (error instanceof Error) {
      core.setFailed(error.message);
    }
  }
}

async function installCorelliumCli(): Promise<void> {
  core.info('Installing Corellium-CLI...');
  await exec('npm install -g @corellium/corellium-cli');
  await execCmd(`corellium login --endpoint ${core.getInput('server')} --apitoken ${process.env.API_TOKEN}`);
}

async function setupDevice(): Promise<string> {
  const projectId = process.env.PROJECT;

  core.info('Creating device...');
  const resp = await execCmd(
    `corellium instance create ${core.getInput('flavor')} ${core.getInput('os')} ${projectId} --wait`,
  );
  const instanceId = resp?.toString().trim();

  core.info('Downloading app...');
  const appPath = await downloadFile('appFile', core.getInput('appUrl'));

  core.info(`Installing app on ${instanceId}...`);
  await execCmd(`corellium apps install --project ${projectId} --instance ${instanceId} --app ${appPath}`);

  return instanceId;
}

async function runMatrix(instanceId: string): Promise<string> {
  const [bundleId, wordlistId, inputInfo] = await Promise.all([
    getBundleId(instanceId),
    uploadWordlistFile(instanceId),
    downloadInputFile(),
  ]);

  const inputsFilePath = inputInfo.inputsFilePath;
  const inputsTimeout = inputInfo.inputsTimeout;

  core.info('Running MATRIX...');

  core.info('Creating assessment...');
  let assessmentId: string | undefined;
  try {
    let createAssessment = `corellium mast create-assessment --instance ${instanceId} --bundle ${bundleId}`;
    if (wordlistId) {
      createAssessment += ` --wordlist ${wordlistId}`;
    }
    const resp = await execCmd(createAssessment);
    assessmentId = (tryJsonParse(resp) as { id: string })?.id;
    core.info(`Created assessment ${assessmentId}...`);
  } catch (err) {
    throw new Error(`Error creating MATRIX assessment! err=${err}`);
  }

  await pollAssessmentForStatus(assessmentId, instanceId, 'new');
  core.info('Starting monitor...');
  await execCmd(`corellium mast start-monitor --instance ${instanceId} --assessment ${assessmentId}`);

  await pollAssessmentForStatus(assessmentId, instanceId, 'monitoring');
  core.info('Executing inputs on device...');
  await execCmd(`corellium input ${instanceId} ${inputsFilePath}`);
  core.info(`Waiting ${inputsTimeout}ms for inputs to execute...`);
  await wait(inputsTimeout);

  core.info('Stopping monitor...');
  await execCmd(`corellium mast stop-monitor --instance ${instanceId} --assessment ${assessmentId}`);

  await pollAssessmentForStatus(assessmentId, instanceId, 'readyForTesting');
  core.info('Executing tests...');
  await execCmd(`corellium mast test --instance ${instanceId} --assessment ${assessmentId}`);

  await pollAssessmentForStatus(assessmentId, instanceId, 'complete');
  core.info('Downloading assessment...');
  return await execCmd(`corellium mast download-report --instance ${instanceId} --assessment ${assessmentId}`);
}

async function cleanup(instanceId: string): Promise<void> {
  core.info('Cleaning up...');
  await execCmd(`corellium instance stop ${instanceId}`);
  await execCmd(`corellium instance delete ${instanceId}`);
  await execCmd(`corellium logout`);
}

async function getBundleId(instanceId: string): Promise<string> {
  const resp = await execCmd(`corellium apps --project ${process.env.PROJECT} --instance ${instanceId}`);
  const appList = tryJsonParse(resp) as unknown as { applicationType: string; bundleID: string }[];
  const bundleId = appList?.find(app => app.applicationType === 'User')?.bundleID;
  if (!bundleId) {
    throw new Error('Error getting bundleId!');
  }
  return bundleId;
}

async function uploadWordlistFile(instanceId: string): Promise<string | undefined> {
  const wordlistUrl = core.getInput('wordlistUrl');
  if (!wordlistUrl) {
    return;
  }

  core.info('Uploading wordlist...');
  const wordlistPath = await downloadFile('wordlist.txt', wordlistUrl);
  const resp = await execCmd(
    `corellium image create --project ${process.env.PROJECT} --instance ${instanceId} --format json wordlist.txt mast-wordlist plain ${wordlistPath}`,
  );
  const uploadedWordlistResp = tryJsonParse(resp) as unknown as { id: string }[];
  const wordlistId = uploadedWordlistResp?.[0].id;
  core.info(`Uploaded wordlist: ${wordlistId}`);
  return wordlistId;
}

async function downloadInputFile(): Promise<{ inputsFilePath: string; inputsTimeout: number }> {
  const inputsFilePath = await downloadFile('inputs.json', core.getInput('inputUrl'));

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
  instanceId: string,
  expectedStatus: string,
): Promise<string> {
  const getAssessmentStatus = async (): Promise<string> => {
    const resp = await execCmd(`corellium mast get-assessment --instance ${instanceId} --assessment ${assessmentId}`);
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

async function storeReportInArtifacts(report: string): Promise<void> {
  const workspaceDir = process.env.GITHUB_WORKSPACE as string;
  const reportPath = path.join(workspaceDir, 'report.html');
  fs.writeFileSync(reportPath, report);

  const artifact = new DefaultArtifactClient();

  const { id } = await artifact.uploadArtifact('matrix-report', ['./report.html'], workspaceDir);
  if (!id) {
    throw new Error('Failed to upload MATRIX report artifact!');
  }

  const { downloadPath } = await artifact.downloadArtifact(id);

  core.setOutput('report', downloadPath);
}

function validateInputsAndVars(): void {
  if (!process.env.API_TOKEN) {
    throw new Error('Environment secret missing: API_TOKEN');
  }
  if (!process.env.PROJECT) {
    throw new Error('Environment secret missing: PROJECT');
  }

  // inputs from action file are not validated https://github.com/actions/runner/issues/1070
  const requiredInputs = ['flavor', 'os', 'appUrl', 'inputUrl'];
  requiredInputs.forEach((input: string) => {
    const inputResp = core.getInput(input);
    if (!inputResp || typeof inputResp !== 'string' || inputResp === '') {
      throw new Error(`Input required and not supplied: ${input}`);
    }
  });

  const urlInputs = ['appUrl', 'inputUrl', 'wordlistUrl'];
  urlInputs.forEach((urlInput: string) => {
    const url = core.getInput(urlInput);
    if (url) {
      try {
        new URL(url);
      } catch (_) {
        throw new Error(`Provided URL is invalid: ${urlInput}`);
      }
    }
  });
}

async function downloadFile(fileName: string, url: string): Promise<string> {
  const workspaceDir = process.env.GITHUB_WORKSPACE as string;
  const downloadPath = path.join(workspaceDir, fileName);
  await exec(`curl -L -o ${downloadPath} ${url}`, [], { silent: true });
  return downloadPath;
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
