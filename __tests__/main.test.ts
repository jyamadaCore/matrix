/* eslint-disable @typescript-eslint/no-explicit-any */

import * as core from '@actions/core';
import * as exec from '@actions/exec';
import * as path from 'path';
import { mocked } from 'jest-mock';
import { readFileSync, unlinkSync, promises } from 'fs';
import * as main from '../src/main';

/**
 * Spy on the 'run' function in the main module to monitor its calls.
 */
const runMock = jest.spyOn(main, 'run');

/**
 * Mock the 'fs' module, particularly the 'promises' API and 'readFileSync' function.
 */
jest.mock('fs', () => {
  const actual = jest.requireActual('fs');
  return {
    ...actual,
    promises: { access: jest.fn(), stat: jest.fn() },
    readFileSync: jest.fn(),
  };
});

/**
 * Mock the '@actions/artifact' module, defining mocks for 'uploadArtifact' and 'downloadArtifact' at the top level.
 */
const reportArtifactPath = 'mockDownloadPath';
const uploadArtifactMock = jest.fn(async () => Promise.resolve({ id: 1234 }));
const downloadArtifactMock = jest.fn(async () => Promise.resolve({ downloadPath: reportArtifactPath }));

jest.mock('@actions/artifact', () => {
  return {
    DefaultArtifactClient: jest.fn().mockImplementation(() => ({
      uploadArtifact: uploadArtifactMock,
      downloadArtifact: downloadArtifactMock,
    })),
  };
});

/**
 * Variables to hold mocked functions for core GitHub Actions methods.
 */
let errorMock: jest.SpiedFunction<typeof core.error>;
let getInputMock: jest.SpiedFunction<typeof core.getInput>;
let setFailedMock: jest.SpiedFunction<typeof core.setFailed>;
let setOutputMock: jest.SpiedFunction<typeof core.setOutput>;

/**
 * Main test suite for the action.
 */
describe('action', () => {
  /**
   * A mock URL used in the tests.
   */
  const mockUrl = 'https://www.website.com';

  /**
   * Test suite for the 'pollAssessmentForStatus' function.
   */
  describe('pollAssessmentForStatus', () => {
    /**
     * Reset modules and environment variables before each test.
     */
    beforeEach(() => {
      jest.resetModules();
      process.env.GITHUB_WORKSPACE = path.join(__dirname, '.');
    });

    /**
     * Clear all mocks after each test.
     */
    afterEach(async () => {
      jest.clearAllMocks();
    });

    /**
     * Test that an error is thrown if the assessment goes into a 'failed' state.
     */
    it('should throw an error if the assessment goes into a failed state', async () => {
      /** Spy on the 'exec' function to mock command executions. */
      const execSpy = jest.spyOn(exec, 'exec');
      execSpy
        // Mock the first call to return 'testing' status.
        .mockImplementationOnce(async (_command, _args, options: any) => {
          options.listeners.stdout(Buffer.from(JSON.stringify({ status: 'testing' })));
          return 0;
        })
        // Mock the second call to return 'failed' status.
        .mockImplementationOnce(async (_command, _args, options: any) => {
          options.listeners.stdout(Buffer.from(JSON.stringify({ status: 'failed' })));
          return 0;
        });

      /** Expect the function to throw an error indicating MATRIX test failure. */
      await expect(main.pollAssessmentForStatus('mockAssessmentId', 'mockInstanceId', 'complete')).rejects.toThrow(
        'MATRIX automated test failed!',
      );
      /** Verify that the 'exec' function was called twice. */
      expect(execSpy.mock.calls.length).toBe(2);
    });

    /**
     * Test that polling continues until the desired status is reached.
     */
    it('should keep polling until desired state has been reached', async () => {
      /** Spy on the 'exec' function to mock command executions. */
      const execSpy = jest.spyOn(exec, 'exec');
      execSpy
        // Mock the first call to return 'testing' status.
        .mockImplementationOnce(async (_command, _args, options: any) => {
          options.listeners.stdout(Buffer.from(JSON.stringify({ status: 'testing' })));
          return 0;
        })
        // Mock the second call to return 'testing' status again.
        .mockImplementationOnce(async (_command, _args, options: any) => {
          options.listeners.stdout(Buffer.from(JSON.stringify({ status: 'testing' })));
          return 0;
        })
        // Mock the third call to return the expected 'readyForTesting' status.
        .mockImplementationOnce(async (_command, _args, options: any) => {
          options.listeners.stdout(Buffer.from(JSON.stringify({ status: 'readyForTesting' })));
          return 0;
        });

      /** Call the function and expect it to return the 'readyForTesting' status. */
      const resp = await main.pollAssessmentForStatus('mockAssessmentId', 'mockInstanceId', 'readyForTesting');
      expect(resp).toEqual('readyForTesting');
      /** Verify that the 'exec' function was called three times. */
      expect(execSpy.mock.calls.length).toBe(3);
    }, 10000); // Set a timeout of 10 seconds for the test.
  });

  /**
   * Test suite for the 'getFilePathTypes' function.
   */
  describe('getFilePathTypes', () => {
    /**
     * Reset modules and set up input mocks before each test.
     */
    beforeEach(() => {
      jest.resetModules();
      getInputMock = jest.spyOn(core, 'getInput');
      process.env.GITHUB_WORKSPACE = path.join(__dirname, '.');
    });

    /**
     * Clear all mocks after each test.
     */
    afterEach(async () => {
      jest.clearAllMocks();
    });

    /**
     * Test that an error is thrown if a file path is neither a URL nor a valid relative path.
     */
    it('should throw an error if a file path is neither a URL or relative path', async () => {
      /**
       * Mock 'getInput' to return 'invalid' for 'appPath' and empty strings for others.
       */
      getInputMock.mockImplementation(name => {
        if (name === 'appPath') return 'invalid';
        if (name === 'userActions' || name === 'keywords') return '';
        return '';
      });
      /**
       * Mock 'promises.stat' to simulate file not found error.
       */
      (promises.stat as jest.Mock).mockRejectedValue(new Error('File not found'));

      /** Expect the function to throw an error about invalid file path. */
      await expect(main.getFilePathTypes()).rejects.toThrow('Provided file path is invalid: appPath');
    });

    /**
     * Test that the function correctly identifies relative paths without an initial slash.
     */
    it('should correctly identify relative paths without an initial slash', async () => {
      /**
       * Mock 'getInput' to return 'mockUrl' for 'appPath' and 'test/filePath' for others.
       */
      getInputMock
        .mockImplementationOnce(() => mockUrl) // For 'appPath'
        .mockImplementation(() => 'test/filePath'); // For 'userActions' and 'keywords'

      /**
       * Mock 'promises.stat' to simulate that the file exists.
       */
      const mockStats = {
        isFile: () => true,
        isDirectory: () => false,
      };
      (promises.stat as jest.Mock).mockResolvedValue(mockStats);

      /** Call the function and expect correct path types. */
      const resp = await main.getFilePathTypes();
      expect(resp).toEqual({ appPath: 'url', userActions: 'relative', keywords: 'relative' });
    });

    /**
     * Test that the function returns a dictionary of file path types.
     * Specifically, it tests that when 'appPath' is a URL and 'userActions' and 'keywords' are absolute paths,
     * the function correctly identifies their path types.
     */
    it('should return dict of file path types', async () => {
      /**
       * Mock the 'getInput' function to return specific values for inputs.
       * - For 'appPath', returns 'mockUrl', simulating a URL input.
       * - For 'userActions', returns '/some/relative/path', simulating an absolute path.
       * - For 'keywords', returns '/another/relative/path', simulating another absolute path.
       */
      getInputMock.mockImplementation(name => {
        if (name === 'appPath') return mockUrl;
        if (name === 'userActions') return '/some/relative/path';
        if (name === 'keywords') return '/another/relative/path';
        return '';
      });

      /**
       * Mock 'promises.stat' to always resolve successfully.
       * This simulates that the files exist at the given paths, preventing file system errors during the test.
       */
      (promises.stat as jest.Mock).mockImplementation(async () => Promise.resolve(true));

      /**
       * Call the 'getFilePathTypes' function to get the types of the file paths.
       */
      const resp = await main.getFilePathTypes();

      /**
       * Assert that the function correctly identifies the path types.
       * Expect:
       * - 'appPath' to be identified as 'url'.
       * - 'userActions' and 'keywords' to be identified as 'relative'.
       */
      expect(resp).toEqual({ appPath: 'url', userActions: 'relative', keywords: 'relative' });
    });

    /**
     * Test that the function correctly identifies path types and adds an initial forward slash if missing in relative paths.
     */
    it('should add initial forward slash if missing', async () => {
      /**
       * Mock 'getInput' to return 'mockUrl' for 'appPath' and 'test/filePath' for others.
       */
      getInputMock.mockImplementation(() => 'test/filePath').mockImplementationOnce(() => mockUrl);

      /**
       * Mock 'promises.stat' to always resolve successfully.
       */
      (promises.stat as jest.Mock).mockImplementation(async () => Promise.resolve(true));

      /** Call the function and expect correct path types. */
      const resp = await main.getFilePathTypes();
      expect(resp).toEqual({ appPath: 'url', userActions: 'relative', keywords: 'relative' });
    });
  });

  /**
   * Test suite for the 'run' function.
   */
  describe('run', () => {
    /**
     * The mock 'instanceId' used in the tests.
     */
    const instanceId = 'mockInstanceId';
    /**
     * The mock 'wordlistId' used in the tests.
     */
    const wordlistId = 'wordlistId';

    /**
     * Helper function to validate that a command includes the expected substring.
     * @param actual - The actual command executed.
     * @param expected - The expected substring.
     */
    const validateExecCall = async (actual: string, expected: string): Promise<void> => {
      expect(actual).toEqual(expect.stringContaining(expected));
    };

    /**
     * Set up mocks and environment variables before each test.
     */
    beforeEach(() => {
      jest.clearAllMocks(); // Reset mocks between tests

      /** Spy on the 'exec' function and provide default implementations. */
      jest.spyOn(exec, 'exec').mockImplementation(async (cmd, args, options) => {
        if (options && options.listeners && options.listeners.stdout) {
          // Simulate command outputs based on the command
          if (cmd.includes('corellium instance get')) {
            options.listeners.stdout(Buffer.from(JSON.stringify({ state: 'on', ready: true })));
          } else if (cmd.includes('corellium instance ready')) {
            options.listeners.stdout(Buffer.from(JSON.stringify({ ready: true })));
          } else if (cmd.includes('corellium instance create')) {
            options.listeners.stdout(Buffer.from(instanceId));
          } else if (cmd.includes('corellium apps --project')) {
            options.listeners.stdout(
              Buffer.from(JSON.stringify([{ applicationType: 'User', bundleID: 'mockBundleId' }])),
            );
          }
        }
        return 0;
      });

      /** Mock core GitHub Actions methods. */
      errorMock = jest.spyOn(core, 'error').mockImplementation();
      getInputMock = jest.spyOn(core, 'getInput').mockImplementation();
      setFailedMock = jest.spyOn(core, 'setFailed').mockImplementation();
      setOutputMock = jest.spyOn(core, 'setOutput').mockImplementation();

      /** Mock 'readFileSync' to return a JSON string representing input actions. */
      mocked(readFileSync).mockReturnValueOnce(JSON.stringify([{ wait: 100 }, { duration: 400 }]));

      /** Set environment variables for the tests. */
      process.env.PROJECT = 'mockProjectId';
      process.env.API_TOKEN = 'mockApiToken';
      process.env.GITHUB_WORKSPACE = path.join(__dirname, '.');
    });

    /**
     * Clear all mocks after each test.
     */
    afterEach(async () => {
      jest.clearAllMocks();
    });

    /**
     * Test that an error is thrown if the 'PROJECT' environment variable is missing.
     */
    it(`should throw an error if 'PROJECT' secret is missing`, async () => {
      /** Delete the 'PROJECT' environment variable. */
      delete process.env.PROJECT;

      /** Call the main 'run' function. */
      await main.run();

      /** Expect the 'run' function to have returned. */
      expect(runMock).toHaveReturned();
      /** Expect 'setFailed' to have been called with the specific error message. */
      expect(setFailedMock).toHaveBeenCalledWith('Environment secret missing: PROJECT');
      /** Expect 'error' not to have been called. */
      expect(errorMock).not.toHaveBeenCalled();
    });

    /**
     * Test that an error is thrown if the 'API_TOKEN' environment variable is missing.
     */
    it(`should throw an error if 'API_TOKEN' secret is missing`, async () => {
      /** Delete the 'API_TOKEN' environment variable. */
      delete process.env.API_TOKEN;

      /** Call the main 'run' function. */
      await main.run();

      /** Expect the 'run' function to have returned. */
      expect(runMock).toHaveReturned();
      /** Expect 'setFailed' to have been called with the specific error message. */
      expect(setFailedMock).toHaveBeenCalledWith('Environment secret missing: API_TOKEN');
      /** Expect 'error' not to have been called. */
      expect(errorMock).not.toHaveBeenCalled();
    });

    /**
     * Test that an error is thrown if 'deviceFlavor' input is missing when 'deviceId' is not provided.
     */
    it(`should throw an error if 'deviceFlavor' input is missing`, async () => {
      /**
       * Mock 'getInput' to simulate missing 'deviceFlavor' and 'deviceId'.
       */
      getInputMock.mockImplementation(name => {
        if (name === 'deviceFlavor') return '';
        if (name === 'deviceId') return ''; // Ensure 'deviceId' is not set
        return 'mockVal';
      });

      await main.run();

      /** Expect 'setFailed' to have been called with the specific error message. */
      expect(setFailedMock).toHaveBeenCalledWith('Input required and not supplied: deviceFlavor');
      /** Expect 'error' not to have been called. */
      expect(errorMock).not.toHaveBeenCalled();
    });

    it(`should throw an error if 'deviceOS' input is missing`, async () => {
      /**
       * Mock 'getInput' to simulate missing 'deviceOS' and 'deviceId'.
       */
      getInputMock.mockImplementation(name => {
        if (name === 'deviceOS') return '';
        if (name === 'deviceId') return ''; // Ensure 'deviceId' is not set
        return 'mockVal';
      });

      await main.run();

      /** Expect 'setFailed' to have been called with the specific error message. */
      expect(setFailedMock).toHaveBeenCalledWith('Input required and not supplied: deviceOS');
      /** Expect 'error' not to have been called. */
      expect(errorMock).not.toHaveBeenCalled();
    });

    /**
     * Test that an error is thrown if 'appPath' input is missing.
     */
    it(`should throw an error if 'appPath' input is missing`, async () => {
      /**
       * Mock 'getInput' to simulate missing 'appPath'.
       */
      getInputMock.mockImplementation(name => (name === 'appPath' ? '' : 'mockVal'));

      /** Call the main 'run' function. */
      await main.run();

      /** Expect the 'run' function to have returned. */
      expect(runMock).toHaveReturned();
      /** Expect 'setFailed' to have been called with the specific error message. */
      expect(setFailedMock).toHaveBeenCalledWith('Input required and not supplied: appPath');
      /** Expect 'error' not to have been called. */
      expect(errorMock).not.toHaveBeenCalled();
    });

    /**
     * Test that an error is thrown if 'appPath' input is invalid.
     */
    it(`should throw an error if 'appPath' input is invalid`, async () => {
      /**
       * Mock 'getInput' to return 'invalid' for 'appPath'.
       */
      getInputMock.mockImplementation(name => (name === 'appPath' ? 'invalid' : mockUrl));
      /**
       * Mock 'promises.stat' to simulate that the file does not exist.
       */
      (promises.stat as jest.Mock).mockImplementation(async () => Promise.resolve(false));

      /** Call the main 'run' function. */
      await main.run();

      /** Expect the 'run' function to have returned. */
      expect(runMock).toHaveReturned();
      /** Expect 'setFailed' to have been called with the specific error message. */
      expect(setFailedMock).toHaveBeenCalledWith('Provided file path is invalid: appPath');
      /** Expect 'error' not to have been called. */
      expect(errorMock).not.toHaveBeenCalled();
    });

    /**
     * Test that an error is thrown if 'userActions' input is missing.
     */
    it(`should throw an error if 'userActions' input is missing`, async () => {
      /**
       * Mock 'getInput' to simulate missing 'userActions'.
       */
      getInputMock.mockImplementation(name => (name === 'userActions' ? '' : 'mockVal'));

      /** Call the main 'run' function. */
      await main.run();

      /** Expect the 'run' function to have returned. */
      expect(runMock).toHaveReturned();
      /** Expect 'setFailed' to have been called with the specific error message. */
      expect(setFailedMock).toHaveBeenCalledWith('Input required and not supplied: userActions');
      /** Expect 'error' not to have been called. */
      expect(errorMock).not.toHaveBeenCalled();
    });

    /**
     * Test that an error is thrown if 'userActions' input is invalid.
     */
    it(`should throw an error if 'userActions' input is invalid`, async () => {
      /**
       * Mock 'getInput' to return 'notValid' for 'userActions'.
       */
      getInputMock.mockImplementation(name => (name === 'userActions' ? 'notValid' : mockUrl));
      /**
       * Mock 'promises.stat' to simulate that the file does not exist.
       */
      (promises.stat as jest.Mock).mockImplementation(async () => Promise.resolve(false));

      /** Call the main 'run' function. */
      await main.run();

      /** Expect the 'run' function to have returned. */
      expect(runMock).toHaveReturned();
      /** Expect 'setFailed' to have been called with the specific error message. */
      expect(setFailedMock).toHaveBeenCalledWith('Provided file path is invalid: userActions');
      /** Expect 'error' not to have been called. */
      expect(errorMock).not.toHaveBeenCalled();
    });

    /**
     * Test that an error is thrown if 'keywords' input exists and is invalid.
     */
    it(`should throw an error if 'keywords' exists and is invalid`, async () => {
      /**
       * Mock 'getInput' to return 'invalid' for 'keywords'.
       */
      getInputMock.mockImplementation(name => (name === 'keywords' ? 'invalid' : mockUrl));
      /**
       * Mock 'promises.stat' to simulate that the file does not exist.
       */
      (promises.stat as jest.Mock).mockImplementation(async () => Promise.resolve(false));

      /** Call the main 'run' function. */
      await main.run();

      /** Expect the 'run' function to have returned. */
      expect(runMock).toHaveReturned();
      /** Expect 'setFailed' to have been called with the specific error message. */
      expect(setFailedMock).toHaveBeenCalledWith('Provided file path is invalid: keywords');
      /** Expect 'error' not to have been called. */
      expect(errorMock).not.toHaveBeenCalled();
    });

    /**
     * Test that the action executes MATRIX on an Android device successfully.
     */
    it('should execute MATRIX on android device', async () => {
      /** The workspace directory from the environment variable. */
      const workspaceDir = process.env.GITHUB_WORKSPACE as string;

      /** The expected bundle ID for the Android app. */
      const bundleId = 'com.android.egg';

      /**
       * Mock implementation of 'getInput' to provide necessary inputs for the test.
       * Returns specific values based on the input name.
       */
      getInputMock.mockImplementation(input => {
        if (input === 'appPath') {
          return mockUrl;
        }
        if (input === 'userActions') {
          return '/test/user-actions.json';
        }
        if (input === 'keywords') {
          return 'test/keywords.txt';
        }
        if (input === 'deviceFlavor' || input === 'deviceOS' || input === 'server') {
          return 'mockVal';
        }
        return '';
      });

      /**
       * Mock 'promises.stat' to simulate that files exist, preventing file system errors during the test.
       */
      (promises.stat as jest.Mock).mockImplementation(async () => Promise.resolve(true));

      /** Spy on the 'exec' function from '@actions/exec' to mock command executions. */
      const execSpy = jest.spyOn(exec, 'exec');

      execSpy
        // Mock installation of the Corellium CLI.
        .mockImplementationOnce(async () => Promise.resolve(0))
        // Mock logging into the Corellium CLI.
        .mockImplementationOnce(async () => Promise.resolve(0))
        // Mock creation of a new instance, returning the 'instanceId'.
        .mockImplementationOnce(async (_command, _args, options: any) => {
          options.listeners.stdout(Buffer.from(instanceId));
          return 0;
        })
        // Mock downloading the app.
        .mockImplementationOnce(async () => Promise.resolve(0))
        // Mock installing the app on the instance.
        .mockImplementationOnce(async () => Promise.resolve(0))
        // Mock getting instance details, returning an Android type.
        .mockImplementationOnce(async (_command, _args, options: any) => {
          options.listeners.stdout(Buffer.from(JSON.stringify({ type: 'android' })));
          return 0;
        })
        // Mock getting the bundle ID of the installed app.
        .mockImplementationOnce(async (_command, _args, options: any) => {
          options.listeners.stdout(Buffer.from(JSON.stringify([{ applicationType: 'User', bundleID: bundleId }])));
          return 0;
        })
        // Mock opening the app on the instance.
        .mockImplementationOnce(async () => Promise.resolve(0))
        // Mock uploading the wordlist file, returning the 'wordlistId'.
        .mockImplementationOnce(async (_command, _args, options: any) => {
          options.listeners.stdout(Buffer.from(JSON.stringify([{ id: wordlistId }])));
          return 0;
        })
        // Mock creating a MATRIX assessment, returning the assessment ID.
        .mockImplementationOnce(async (_command, _args, options: any) => {
          options.listeners.stdout(Buffer.from(JSON.stringify({ id: 'mockAssessmentId' })));
          return 0;
        })
        // Mock polling the assessment status to 'new'.
        .mockImplementationOnce(async (_command, _args, options: any) => {
          options.listeners.stdout(Buffer.from(JSON.stringify({ status: 'new' })));
          return 0;
        })
        // Mock starting the monitor.
        .mockImplementationOnce(async () => Promise.resolve(0))
        // Mock polling the assessment status to 'monitoring'.
        .mockImplementationOnce(async (_command, _args, options: any) => {
          options.listeners.stdout(Buffer.from(JSON.stringify({ status: 'monitoring' })));
          return 0;
        })
        // Mock executing inputs on the device.
        .mockImplementationOnce(async () => Promise.resolve(0))
        // Mock waiting for inputs to execute.
        .mockImplementationOnce(async () => Promise.resolve(0))
        // Mock polling the assessment status to 'readyForTesting'.
        .mockImplementationOnce(async (_command, _args, options: any) => {
          options.listeners.stdout(Buffer.from(JSON.stringify({ status: 'readyForTesting' })));
          return 0;
        })
        // Mock executing tests.
        .mockImplementationOnce(async () => Promise.resolve(0))
        // Mock polling the assessment status to 'complete'.
        .mockImplementationOnce(async (_command, _args, options: any) => {
          options.listeners.stdout(Buffer.from(JSON.stringify({ status: 'complete' })));
          return 0;
        })
        // Mock downloading the assessment report.
        .mockImplementationOnce(async (_command, _args, options: any) => {
          options.listeners.stdout(Buffer.from('mastReport'));
          return 0;
        })
        // Cleanup: Mock stopping the instance.
        .mockImplementationOnce(async () => Promise.resolve(0))
        // Cleanup: Mock deleting the instance.
        .mockImplementationOnce(async () => Promise.resolve(0))
        // Mock logging out of the Corellium CLI.
        .mockImplementationOnce(async () => Promise.resolve(0));

      /** Execute the main action function. */
      await main.run();

      /** Verify that the 'run' function has completed. */
      expect(runMock).toHaveReturned();

      /** Verify that the artifact upload function was called. */
      expect(uploadArtifactMock).toHaveBeenCalled();

      /** Verify that the artifact download function was called. */
      expect(downloadArtifactMock).toHaveBeenCalled();

      /** Verify that the 'report' output was set with the correct path. */
      expect(setOutputMock).toHaveBeenNthCalledWith(1, 'report', expect.stringMatching(reportArtifactPath));

      /** Validate the sequence of executed commands. */
      validateExecCall(execSpy.mock.calls[0][0], 'npm install -g @corellium/corellium-cli');
      validateExecCall(execSpy.mock.calls[1][0], 'corellium login --endpoint');
      validateExecCall(execSpy.mock.calls[2][0], 'corellium instance create');
      validateExecCall(execSpy.mock.calls[3][0], `curl -L -o ${path.join(workspaceDir, 'appFile')} ${mockUrl}`);
      validateExecCall(execSpy.mock.calls[4][0], 'corellium apps install --project');
      validateExecCall(execSpy.mock.calls[5][0], 'corellium instance get --instance');
      validateExecCall(execSpy.mock.calls[6][0], 'corellium apps --project');
      validateExecCall(execSpy.mock.calls[7][0], 'corellium apps open --project');
      validateExecCall(execSpy.mock.calls[8][0], 'corellium image create --project');
      validateExecCall(
        execSpy.mock.calls[9][0],
        `corellium matrix create-assessment --instance ${instanceId} --bundle ${bundleId} --wordlist ${wordlistId}`,
      );
      validateExecCall(execSpy.mock.calls[10][0], `corellium matrix get-assessment --instance ${instanceId}`);
      validateExecCall(execSpy.mock.calls[11][0], `corellium matrix start-monitor --instance ${instanceId}`);
      validateExecCall(execSpy.mock.calls[12][0], `corellium matrix get-assessment --instance ${instanceId}`);
      validateExecCall(execSpy.mock.calls[13][0], `corellium input ${instanceId}`);
      validateExecCall(execSpy.mock.calls[14][0], `corellium matrix stop-monitor --instance ${instanceId}`);
      validateExecCall(execSpy.mock.calls[15][0], `corellium matrix get-assessment --instance ${instanceId}`);
      validateExecCall(execSpy.mock.calls[16][0], `corellium matrix test --instance ${instanceId}`);
      validateExecCall(execSpy.mock.calls[17][0], `corellium matrix get-assessment --instance ${instanceId}`);
      validateExecCall(execSpy.mock.calls[18][0], `corellium matrix download-report --instance ${instanceId}`);
      validateExecCall(execSpy.mock.calls[19][0], `corellium instance stop ${instanceId}`);
      validateExecCall(execSpy.mock.calls[20][0], `corellium instance delete ${instanceId}`);
      validateExecCall(execSpy.mock.calls[21][0], 'corellium logout');

      // Clean up any created files
      try {
        /**
         * Attempt to remove the 'report.html' file if it exists.
         * This ensures that no artifacts are left after the test.
         */
        unlinkSync(path.join(__dirname, './report.html'));
      } catch (error) {
        // Ignore if the file doesn't exist.
      }
    }, 15000); // Specify a timeout of 15 seconds for the test.

    /**
     * Test that the action executes MATRIX on an iOS device successfully.
     */
    it('should execute MATRIX on iOS device', async () => {
      /** The workspace directory from the environment variable. */
      const workspaceDir = process.env.GITHUB_WORKSPACE as string;

      /** The expected bundle ID for the iOS app. */
      const bundleId = 'com.apple.compass';

      /**
       * Mock implementation of 'getInput' to provide necessary inputs for the test.
       * Returns specific values based on the input name.
       */
      getInputMock.mockImplementation(input => {
        if (input === 'appPath') {
          return mockUrl;
        }
        if (input === 'userActions') {
          return '/test/user-actions.json';
        }
        if (input === 'keywords') {
          return 'test/keywords.txt';
        }
        if (input === 'deviceFlavor' || input === 'deviceOS' || input === 'server') {
          return 'mockVal';
        }
        return '';
      });

      /**
       * Mock 'promises.stat' to simulate that files exist, preventing file system errors during the test.
       */
      (promises.stat as jest.Mock).mockImplementation(async () => Promise.resolve(true));

      /** Spy on the 'exec' function from '@actions/exec' to mock command executions. */
      const execSpy = jest.spyOn(exec, 'exec');

      execSpy
        // Mock installation of the Corellium CLI.
        .mockImplementationOnce(async () => Promise.resolve(0))
        // Mock logging into the Corellium CLI.
        .mockImplementationOnce(async () => Promise.resolve(0))
        // Mock creation of a new instance, returning the 'instanceId'.
        .mockImplementationOnce(async (_command, _args, options: any) => {
          options.listeners.stdout(Buffer.from(instanceId));
          return 0;
        })
        // Mock downloading the app.
        .mockImplementationOnce(async () => Promise.resolve(0))
        // Mock installing the app on the instance.
        .mockImplementationOnce(async () => Promise.resolve(0))
        // Mock getting instance details, returning an iOS type.
        .mockImplementationOnce(async (_command, _args, options: any) => {
          options.listeners.stdout(Buffer.from(JSON.stringify({ type: 'ios' })));
          return 0;
        })
        // Mock unlocking the iOS device.
        .mockImplementationOnce(async () => Promise.resolve(0))
        // Mock getting the bundle ID of the installed app.
        .mockImplementationOnce(async (_command, _args, options: any) => {
          options.listeners.stdout(Buffer.from(JSON.stringify([{ applicationType: 'User', bundleID: bundleId }])));
          return 0;
        })
        // Mock opening the app on the instance.
        .mockImplementationOnce(async () => Promise.resolve(0))
        // Mock uploading the wordlist file, returning the 'wordlistId'.
        .mockImplementationOnce(async (_command, _args, options: any) => {
          options.listeners.stdout(Buffer.from(JSON.stringify([{ id: wordlistId }])));
          return 0;
        })
        // Mock creating a MATRIX assessment, returning the assessment ID.
        .mockImplementationOnce(async (_command, _args, options: any) => {
          options.listeners.stdout(Buffer.from(JSON.stringify({ id: 'mockAssessmentId' })));
          return 0;
        })
        // Mock polling the assessment status to 'new'.
        .mockImplementationOnce(async (_command, _args, options: any) => {
          options.listeners.stdout(Buffer.from(JSON.stringify({ status: 'new' })));
          return 0;
        })
        // Mock starting the monitor.
        .mockImplementationOnce(async () => Promise.resolve(0))
        // Mock polling the assessment status to 'monitoring'.
        .mockImplementationOnce(async (_command, _args, options: any) => {
          options.listeners.stdout(Buffer.from(JSON.stringify({ status: 'monitoring' })));
          return 0;
        })
        // Mock executing inputs on the device.
        .mockImplementationOnce(async () => Promise.resolve(0))
        // Mock waiting for inputs to execute.
        .mockImplementationOnce(async () => Promise.resolve(0))
        // Mock polling the assessment status to 'readyForTesting'.
        .mockImplementationOnce(async (_command, _args, options: any) => {
          options.listeners.stdout(Buffer.from(JSON.stringify({ status: 'readyForTesting' })));
          return 0;
        })
        // Mock executing tests.
        .mockImplementationOnce(async () => Promise.resolve(0))
        // Mock polling the assessment status to 'complete'.
        .mockImplementationOnce(async (_command, _args, options: any) => {
          options.listeners.stdout(Buffer.from(JSON.stringify({ status: 'complete' })));
          return 0;
        })
        // Mock downloading the assessment report.
        .mockImplementationOnce(async (_command, _args, options: any) => {
          options.listeners.stdout(Buffer.from('mastReport'));
          return 0;
        })
        // Cleanup: Mock stopping the instance.
        .mockImplementationOnce(async () => Promise.resolve(0))
        // Cleanup: Mock deleting the instance.
        .mockImplementationOnce(async () => Promise.resolve(0))
        // Mock logging out of the Corellium CLI.
        .mockImplementationOnce(async () => Promise.resolve(0));

      /** Execute the main action function. */
      await main.run();

      /** Verify that the 'run' function has completed. */
      expect(runMock).toHaveReturned();

      /** Verify that the artifact upload function was called. */
      expect(uploadArtifactMock).toHaveBeenCalled();

      /** Verify that the artifact download function was called. */
      expect(downloadArtifactMock).toHaveBeenCalled();

      /** Verify that the 'report' output was set with the correct path. */
      expect(setOutputMock).toHaveBeenNthCalledWith(1, 'report', expect.stringMatching(reportArtifactPath));

      /** Validate the sequence of executed commands. */
      validateExecCall(execSpy.mock.calls[0][0], 'npm install -g @corellium/corellium-cli');
      validateExecCall(execSpy.mock.calls[1][0], 'corellium login --endpoint');
      validateExecCall(execSpy.mock.calls[2][0], 'corellium instance create');
      validateExecCall(execSpy.mock.calls[3][0], `curl -L -o ${path.join(workspaceDir, 'appFile')} ${mockUrl}`);
      validateExecCall(execSpy.mock.calls[4][0], 'corellium apps install --project');
      validateExecCall(execSpy.mock.calls[5][0], 'corellium instance get --instance');
      validateExecCall(execSpy.mock.calls[6][0], 'corellium instance unlock --instance');
      validateExecCall(execSpy.mock.calls[7][0], 'corellium apps --project');
      validateExecCall(execSpy.mock.calls[8][0], 'corellium apps open --project');
      validateExecCall(execSpy.mock.calls[9][0], 'corellium image create --project');
      validateExecCall(
        execSpy.mock.calls[10][0],
        `corellium matrix create-assessment --instance ${instanceId} --bundle ${bundleId} --wordlist ${wordlistId}`,
      );
      validateExecCall(execSpy.mock.calls[11][0], `corellium matrix get-assessment --instance ${instanceId}`);
      validateExecCall(execSpy.mock.calls[12][0], `corellium matrix start-monitor --instance ${instanceId}`);
      validateExecCall(execSpy.mock.calls[13][0], `corellium matrix get-assessment --instance ${instanceId}`);
      validateExecCall(execSpy.mock.calls[14][0], `corellium input ${instanceId}`);
      validateExecCall(execSpy.mock.calls[15][0], `corellium matrix stop-monitor --instance ${instanceId}`);
      validateExecCall(execSpy.mock.calls[16][0], `corellium matrix get-assessment --instance ${instanceId}`);
      validateExecCall(execSpy.mock.calls[17][0], `corellium matrix test --instance ${instanceId}`);
      validateExecCall(execSpy.mock.calls[18][0], `corellium matrix get-assessment --instance ${instanceId}`);
      validateExecCall(execSpy.mock.calls[19][0], `corellium matrix download-report --instance ${instanceId}`);
      validateExecCall(execSpy.mock.calls[20][0], `corellium instance stop ${instanceId}`);
      validateExecCall(execSpy.mock.calls[21][0], `corellium instance delete ${instanceId}`);
      validateExecCall(execSpy.mock.calls[22][0], 'corellium logout');

      // Clean up any created files
      try {
        /**
         * Attempt to remove the 'report.html' file if it exists.
         * This ensures that no artifacts are left after the test.
         */
        unlinkSync(path.join(__dirname, './report.html'));
      } catch (error) {
        // Ignore if the file doesn't exist.
      }
    }, 15000); // Specify a timeout of 15 seconds for the test.
  });
});
