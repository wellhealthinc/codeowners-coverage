import * as core from '@actions/core';
import * as github from '@actions/github';
import * as glob from "@actions/glob";
import { readFileSync } from 'fs';

interface Input {
  token: string;
  'include-gitignore': boolean;
  'ignore-default': boolean;
  files: string;
}

export function getInputs(): Input {
  const result = {} as Input;
  result.token = core.getInput('github-token');
  result['include-gitignore'] = core.getBooleanInput('include-gitignore');
  result['ignore-default'] = core.getBooleanInput('ignore-default');
  result.files = core.getInput('files');
  return result;
}

export const runAction = async (input: Input): Promise<void> => {
  let allFiles: string[] = [];
  if (input.files) {
    allFiles = input.files.split(' ');
    allFiles = await (await glob.create(allFiles.join('\n'))).glob();
  } else {
    allFiles = await (await glob.create('*')).glob();
  }
  core.startGroup(`All Files: ${allFiles.length}`);
  core.info(JSON.stringify(allFiles));
  core.endGroup();

  let codeownersBuffer: string;
  try {
    codeownersBuffer = readFileSync('CODEOWNERS', 'utf8');
  } catch (error) {
    try {
      codeownersBuffer = readFileSync('.github/CODEOWNERS', 'utf8');
    } catch (error) {
      throw new Error('No CODEOWNERS file found');
    }
  }
  core.startGroup('CODEOWNERS File');
  core.info(codeownersBuffer);
  core.endGroup();
  let codeownersBufferFiles = codeownersBuffer.split('\n').map(line => line.split(' ')[0]);
  codeownersBufferFiles = codeownersBufferFiles.filter(file => !file.startsWith('#'));
  codeownersBufferFiles = codeownersBufferFiles.map(file => file.replace(/^\//, ''));
  if (input['ignore-default'] === true) {
    codeownersBufferFiles = codeownersBufferFiles.filter(file => file !== '*');
  }
  const codeownersGlob = await glob.create(codeownersBufferFiles.join('\n'));
  let codeownersFiles = await codeownersGlob.glob();
  core.startGroup(`CODEOWNERS Files: ${codeownersFiles.length}`);
  core.info(JSON.stringify(codeownersFiles));
  core.endGroup();
  codeownersFiles = codeownersFiles.filter(file => allFiles.includes(file));
  core.info(`CODEOWNER Files in All Files: ${codeownersFiles.length}`);
  core.startGroup('CODEOWNERS');
  core.info(JSON.stringify(codeownersFiles));
  core.endGroup();

  let gitIgnoreFiles: string[] = [];
  try {
    const gitIgnoreBuffer = readFileSync('.gitignore', 'utf8');
    const gitIgnoreGlob = await glob.create(gitIgnoreBuffer);
    gitIgnoreFiles = await gitIgnoreGlob.glob();
    core.info(`.gitignore Files: ${gitIgnoreFiles.length}`);
  } catch (error) {
    core.info('No .gitignore file found');
  }

  let filesCovered = codeownersFiles;
  let allFilesClean = allFiles;
  if (input['include-gitignore'] === true) {
    allFilesClean = allFiles.filter(file => !gitIgnoreFiles.includes(file));
    filesCovered = filesCovered.filter(file => !gitIgnoreFiles.includes(file));
  }
  if (input.files) {
    filesCovered = filesCovered.filter(file => allFilesClean.includes(file));
  }
  const coveragePercent = (filesCovered.length / allFilesClean.length) * 100;
  const coverageMessage = `${filesCovered.length}/${allFilesClean.length}(${coveragePercent.toFixed(2)}%) files covered by CODEOWNERS`;
  core.notice(coverageMessage, {
    title: 'Coverage',
    file: 'CODEOWNERS'
  });

  const filesNotCovered = allFilesClean.filter(f => !filesCovered.includes(f));
  core.info(`Files not covered: ${filesNotCovered.length}`);

  if (github.context.eventName === 'pull_request' && filesNotCovered.length > 0) {
    filesNotCovered.forEach(file => {
      console.log(file);
      core.error('File not covered by CODEOWNERS', {
        title: 'Coverage',
        file: file
      });
    });
    core.setFailed('Not all files are covered by CODEOWNERS');
  }
}

const run = async (): Promise<void> => {
  try {
    const input = getInputs();
    return runAction(input);
  } catch (error) {
    core.startGroup(error instanceof Error ? error.message : JSON.stringify(error));
    core.info(JSON.stringify(error, null, 2));
    core.endGroup();
  }
};

export default run;
