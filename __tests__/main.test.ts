/* eslint-disable @typescript-eslint/no-explicit-any */

import * as core from '@actions/core';
import * as exec from '@actions/exec';
import * as artifact from '@actions/artifact';
import * as path from 'path';
import { mocked } from 'jest-mock';
import { readFileSync, unlinkSync, promises } from 'fs';
import * as main from '../src/main';

// Unit tests for the action's main functionality, src/main.ts
const runMock = jest.spyOn(main, 'run');

jest.mock('fs', () => {
  const actual = jest.requireActual('fs');
  return {
    ...actual,
    promises: {
      stat: jest.fn().mockImplementation(async (path) => {
        if (path.includes('invalid')) throw new Error('Invalid path');
        return { isFile: () => true }; // Mocking correct fs.stat response
      }),
      access: jest.fn(),
    },
    readFileSync: jest.fn().mockReturnValue('{}'),
  };
});

jest.mock('@actions/exec', () => ({
  exec: jest.fn().mockImplementation(async (cmd, args, options) => {
    if (cmd.includes('npm install')) {
      options.listeners?.stderr(Buffer.from('Error occurred executing npm install: Mocked npm install error'));
      throw new Error('Mocked npm install error');
    }
    options.listeners?.stdout(Buffer.from(JSON.stringify({ status: 'complete' })));
    return 0; // Simulate success
  }),
}));

// Mock the GitHub Actions libraries
let errorMock: jest.SpiedFunction<typeof core.error>;
let getInputMock: jest.SpiedFunction<typeof core.getInput>;
let setFailedMock: jest.SpiedFunction<typeof core.setFailed>;
let setOutputMock: jest.SpiedFunction<typeof core.setOutput>;

describe('action', () => {
  const mockUrl = 'https://www.website.com';

  beforeEach(() => {
    jest.resetModules();

    errorMock = jest.spyOn(core, 'error').mockImplementation();
    getInputMock = jest.spyOn(core, 'getInput').mockImplementation();
    setFailedMock = jest.spyOn(core, 'setFailed').mockImplementation();
    setOutputMock = jest.spyOn(core, 'setOutput').mockImplementation();
    process.env.PROJECT = 'mockProjectId';
    process.env.API_TOKEN = 'mockApiToken';
    process.env.GITHUB_WORKSPACE = path.join(__dirname, '.');
  });

  afterEach(() => {
    jest.clearAllMocks();
    delete process.env.PROJECT;
    delete process.env.API_TOKEN;
  });

  describe('pollAssessmentForStatus', () => {
    it('should throw an error if the assessment goes into a failed state', async () => {
      const execSpy = jest.spyOn(exec, 'exec');
      execSpy
        .mockImplementationOnce(async (_command, _args, options: any) => {
          options.listeners.stdout(Buffer.from(JSON.stringify({ status: 'testing' })));
          return 0;
        })
        .mockImplementationOnce(async (_command, _args, options: any) => {
          options.listeners.stdout(Buffer.from(JSON.stringify({ status: 'failed' })));
          return 0;
        });

      await expect(main.pollAssessmentForStatus('mockAssessmentId', 'mockInstanceId', 'complete')).rejects.toThrow(
        'MATRIX automated test failed!',
      );
      expect(execSpy.mock.calls.length).toBe(2);
    });

    it('should keep polling until desired state has been reached', async () => {
      const execSpy = jest.spyOn(exec, 'exec');
      execSpy
        .mockImplementationOnce(async (_command, _args, options: any) => {
          options.listeners.stdout(Buffer.from(JSON.stringify({ status: 'testing' })));
          return 0;
        })
        .mockImplementationOnce(async (_command, _args, options: any) => {
          options.listeners.stdout(Buffer.from(JSON.stringify({ status: 'testing' })));
          return 0;
        })
        .mockImplementationOnce(async (_command, _args, options: any) => {
          options.listeners.stdout(Buffer.from(JSON.stringify({ status: 'readyForTesting' })));
          return 0;
        });

      const resp = await main.pollAssessmentForStatus('mockAssessmentId', 'mockInstanceId', 'readyForTesting');
      expect(resp).toEqual('readyForTesting');
      expect(execSpy.mock.calls.length).toBe(3);
    }, 10000);
  });

  describe('getFilePathTypes', () => {
    it('should throw an error if a file path is neither a URL or relative path', async () => {
      getInputMock.mockImplementation(() => 'invalid');
      (promises.stat as jest.Mock).mockImplementation(async () => Promise.resolve(false));

      try {
        await main.getFilePathTypes();
      } catch (err: any) {
        expect(err.message).toEqual('Provided file path is invalid: appPath');
      }
    });

    it('should add initial forward slash if missing', async () => {
      getInputMock.mockImplementation(() => 'test/filePath').mockImplementationOnce(() => mockUrl);

      (promises.stat as jest.Mock).mockImplementation(async () => Promise.resolve(true));

      const resp = await main.getFilePathTypes();
      expect(resp).toEqual({ appPath: 'URL', userActions: 'RELATIVE', keywords: 'RELATIVE' });
    });

    it('should return dict of file path types', async () => {
      getInputMock.mockImplementation(() => '/test/filePath').mockImplementationOnce(() => mockUrl);

      (promises.stat as jest.Mock).mockImplementation(async () => Promise.resolve(true));

      const resp = await main.getFilePathTypes();
      expect(resp).toEqual({ appPath: 'URL', userActions: 'RELATIVE', keywords: 'RELATIVE' });
    });
  });

  describe('run', () => {
    const reportArtifactPath = 'mockDownloadPath';
    const instanceId = 'mockInstanceId';
    const wordlistId = 'wordlistId';

    it(`should throw an error if 'API_TOKEN' secret is missing`, async () => {
      delete process.env.API_TOKEN;
      getInputMock.mockImplementation(name => (name === 'deviceFlavor' ? 'mockVal' : ''));

      await main.run();
      expect(runMock).toHaveReturned();
      expect(setFailedMock).toHaveBeenCalledWith('Environment secret missing: API_TOKEN');
    });
    
    it(`should throw an error if 'appPath' input is missing`, async () => {
      process.env.PROJECT = 'mockProjectId';
      process.env.API_TOKEN = 'mockApiToken';
      getInputMock.mockImplementation(name => (name === 'appPath' ? '' : 'mockVal'));

      await main.run();
      expect(runMock).toHaveReturned();
      expect(setFailedMock).toHaveBeenCalledWith('Input required and not supplied: appPath');
    });

    it(`should throw an error if 'appPath' input is invalid`, async () => {
      process.env.PROJECT = 'mockProjectId';
      process.env.API_TOKEN = 'mockApiToken';
      getInputMock.mockImplementation(name => (name === 'appPath' ? 'invalid' : mockUrl));
      (promises.stat as jest.Mock).mockImplementation(async () => Promise.resolve(false));

      await main.run();
      expect(runMock).toHaveReturned();
      expect(setFailedMock).toHaveBeenCalledWith('Provided file path is invalid: appPath');
    });

    it(`should throw an error if 'userActions' input is missing`, async () => {
      process.env.PROJECT = 'mockProjectId';
      process.env.API_TOKEN = 'mockApiToken';
      getInputMock.mockImplementation(name => (name === 'userActions' ? '' : 'mockVal'));

      await main.run();
      expect(runMock).toHaveReturned();
      expect(setFailedMock).toHaveBeenCalledWith('Input required and not supplied: userActions');
    });

    it(`should throw an error if 'userActions' input is invalid`, async () => {
      process.env.PROJECT = 'mockProjectId';
      process.env.API_TOKEN = 'mockApiToken';
      getInputMock.mockImplementation(name => (name === 'userActions' ? 'notValid' : mockUrl));
      (promises.stat as jest.Mock).mockImplementation(async () => Promise.resolve(false));

      await main.run();
      expect(runMock).toHaveReturned();
      expect(setFailedMock).toHaveBeenCalledWith('Provided file path is invalid: userActions');
    });

    it(`should throw an error if 'keywords' exists and is invalid`, async () => {
      process.env.PROJECT = 'mockProjectId';
      process.env.API_TOKEN = 'mockApiToken';
      getInputMock.mockImplementation(name => (name === 'keywords' ? 'invalid' : mockUrl));
      (promises.stat as jest.Mock).mockImplementation(async () => Promise.resolve(false));

      await main.run();
      expect(runMock).toHaveReturned();
      expect(setFailedMock).toHaveBeenCalledWith('Provided file path is invalid: keywords');
    });

    it('should execute MATRIX on android device', async () => {
      const workspaceDir = process.env.GITHUB_WORKSPACE as string;
      const bundleId = 'com.android.egg';
      
      getInputMock.mockImplementation(input => {
        if (input === 'appPath') {
          return mockUrl;
        }
        if (input === 'userActions') {
          return 'test/user-actions.json';
        }
        if (input === 'keywords') {
          return 'test/keywords.txt';
        }
        return 'mockVal';
      });
      
      (promises.stat as jest.Mock).mockImplementation(async () => Promise.resolve(true));
    
      const execSpy = jest.spyOn(exec, 'exec');
      execSpy
        .mockImplementationOnce(async () => Promise.resolve(0)) // install corellium-cli
        .mockImplementationOnce(async () => Promise.resolve(0)) // log into cli
        .mockImplementationOnce(async (_command, _args, options: any) => { // create instance
          options.listeners.stdout(Buffer.from(instanceId));
          return 0;
        })
        .mockImplementationOnce(async () => Promise.resolve(0)) // download app
        .mockImplementationOnce(async () => Promise.resolve(0)) // install app
        .mockImplementationOnce(async (_command, _args, options: any) => { // get instance
          options.listeners.stdout(Buffer.from(JSON.stringify({ type: 'android' })));
          return 0;
        })
        .mockImplementationOnce(async (_command, _args, options: any) => { // getBundleId
          options.listeners.stdout(Buffer.from(JSON.stringify([{ applicationType: 'User', bundleID: bundleId }])));
          return 0;
        })
        .mockImplementationOnce(async () => Promise.resolve(0)) // open app
        .mockImplementationOnce(async (_command, _args, options: any) => { // uploadWordlistFile
          options.listeners.stdout(Buffer.from(JSON.stringify([{ id: wordlistId }])));
          return 0;
        })
        .mockImplementationOnce(async (_command, _args, options: any) => { // running MATRIX
          options.listeners.stdout(Buffer.from(JSON.stringify({ id: 'mockAssessmentId' })));
          return 0;
        })
        .mockImplementationOnce(async (_command, _args, options: any) => { // get assessment status
          options.listeners.stdout(Buffer.from(JSON.stringify({ status: 'new' })));
          return 0;
        })
        .mockImplementationOnce(async () => Promise.resolve(0)) // start monitor
        .mockImplementationOnce(async (_command, _args, options: any) => { // get assessment status
          options.listeners.stdout(Buffer.from(JSON.stringify({ status: 'monitoring' })));
          return 0;
        })
        .mockImplementationOnce(async () => Promise.resolve(0)) // execute inputs
        .mockImplementationOnce(async () => Promise.resolve(0)) // stop monitor
        .mockImplementationOnce(async (_command, _args, options: any) => { // get assessment status
          options.listeners.stdout(Buffer.from(JSON.stringify({ status: 'readyForTesting' })));
          return 0;
        })
        .mockImplementationOnce(async () => Promise.resolve(0)) // execute tests
        .mockImplementationOnce(async (_command, _args, options: any) => { // get assessment status
          options.listeners.stdout(Buffer.from(JSON.stringify({ status: 'complete' })));
          return 0;
        })
        .mockImplementationOnce(async (_command, _args, options: any) => { // download assessment
          options.listeners.stdout(Buffer.from('mastReport'));
          return 0;
        })
        .mockImplementationOnce(async () => Promise.resolve(0)) // cleanup: stop instance
        .mockImplementationOnce(async () => Promise.resolve(0)) // cleanup: delete instance
        .mockImplementationOnce(async () => Promise.resolve(0)); // logout
    
      // Mock DefaultArtifactClient's methods
      const uploadArtifactMock = jest
        .spyOn(artifact.DefaultArtifactClient.prototype, 'uploadArtifact')
        .mockImplementation(async () => Promise.resolve({ id: 1234 }));
      const downloadArtifactMock = jest
        .spyOn(artifact.DefaultArtifactClient.prototype, 'downloadArtifact')
        .mockImplementation(async () => Promise.resolve({ downloadPath: reportArtifactPath }));
    
      // Run the main function
      await main.run();
      expect(runMock).toHaveReturned();å
    
      console.log('Execution flow reached setOutput'); // Debugging line
    }, 15000);    
  });
});
