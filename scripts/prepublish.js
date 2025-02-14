'use strict'

/* eslint-disable no-console */

const axios = require('axios')
const checksum = require('checksum')
const fs = require('fs')
const os = require('os')
const path = require('path')
const rimraf = require('rimraf')
const tar = require('tar')
const { execSync } = require('child_process')

// https://en.wikipedia.org/wiki/ANSI_escape_code#Colors
const color = {
  GRAY: '\\033[1;90m',
  CYAN: '\\033[1;36m',
  NONE: '\\033[0m'
}

const { CIRCLE_TOKEN } = process.env

title('Downloading and compiling files for release.')

const revision = execPipe('git rev-parse HEAD')

console.log(revision)

const branch = execPipe('git symbolic-ref --short HEAD')

console.log(branch)

const headers = CIRCLE_TOKEN
  ? {
      'circle-token': CIRCLE_TOKEN
    }
  : {}
const client = axios.create({
  baseURL: 'https://circleci.com/api/v2/',
  timeout: 5000,
  headers
})

const fetch = (url, options) => {
  console.log(`GET ${url}`)

  return client
    .get(url, options)
    .catch(() => client.get(url, options))
    .catch(() => client.get(url, options))
}

getPipeline()
  .then(getWorkflow)
  .then(getPrebuildsJob)
  .then(getPrebuildArtifacts)
  .then(downloadArtifacts)
  .then(validatePrebuilds)
  .then(extractPrebuilds)
  .catch(e => {
    process.exitCode = 1
    console.error(e)
  })

function getPipeline () {
  return fetch(
    `project/github/DataDog/pprof-nodejs/pipeline?branch=${branch}`
  ).then(response => {
    const pipeline = response.data.items
      .filter(item => item.trigger.type !== 'schedule')
      .find(item => item.vcs.revision === revision)

    if (!pipeline) {
      throw new Error(
        `Unable to find CircleCI pipeline for ${branch}@${revision}.`
      )
    }

    return pipeline
  })
}

function getWorkflow (pipeline) {
  return fetch(`pipeline/${pipeline.id}/workflow`).then(response => {
    const workflows = response.data.items.sort((a, b) =>
      a.stopped_at < b.stopped_at ? 1 : -1
    )
    const workflow = workflows.find(workflow => workflow.name === 'build')

    if (!workflow) {
      throw new Error(
        `Unable to find CircleCI workflow for pipeline ${pipeline.id}.`
      )
    }

    if (!workflow.stopped_at) {
      throw new Error(
        `Workflow ${workflow.id} is still running for pipeline ${pipeline.id}.`
      )
    }

    if (workflow.status !== 'success') {
      throw new Error(
        `Aborting because CircleCI workflow ${workflow.id} did not succeed.`
      )
    }

    return workflow
  })
}

function getPrebuildsJob (workflow) {
  return fetch(`workflow/${workflow.id}/job`).then(response => {
    const job = response.data.items.find(item => item.name === 'prebuilds')

    if (!job) {
      throw new Error(`Missing prebuild jobs in workflow ${workflow.id}.`)
    }

    return job
  })
}

function getPrebuildArtifacts (job) {
  return fetch(
    `project/github/DataDog/pprof-nodejs/${job.job_number}/artifacts`
  ).then(response => {
    const artifacts = response.data.items.filter(artifact =>
      /\/prebuilds\.tgz/.test(artifact.url)
    )

    if (artifacts.length === 0) {
      throw new Error(`Missing artifacts in job ${job.job_number}.`)
    }

    return artifacts
  })
}

function downloadArtifacts (artifacts) {
  const files = artifacts.map(artifact => artifact.url)

  return Promise.all(files.map(downloadArtifact))
}

function downloadArtifact (file) {
  return fetch(file, { responseType: 'stream' }).then(response => {
    const parts = file.split('/')
    const basename = os.tmpdir()
    const filename = parts.slice(-1)[0]

    return new Promise((resolve, reject) => {
      response.data
        .pipe(fs.createWriteStream(path.join(basename, filename)))
        .on('finish', () => resolve())
        .on('error', reject)
    })
  })
}

function validatePrebuilds () {
  const file = path.join(os.tmpdir(), 'prebuilds.tgz')
  const content = fs.readFileSync(file)
  const sum = fs.readFileSync(path.join(`${file}.sha256`), 'ascii')

  if (sum !== checksum(content, { algorithm: 'sha256' })) {
    throw new Error('Invalid checksum for "prebuilds.tgz".')
  }
}

function extractPrebuilds () {
  rimraf.sync('prebuilds')

  return tar.extract({
    file: path.join(os.tmpdir(), 'prebuilds.tgz'),
    cwd: path.join(__dirname, '..')
  })
}

function exec (command, options) {
  options = Object.assign({ stdio: [0, 1, 2] }, options)

  execSync(`echo "${color.GRAY}$ ${command}${color.NONE}"`, { stdio: [0, 1, 2] })

  return execSync(command, options)
}

function execPipe (command, options) {
  return exec(command, Object.assign({ stdio: 'pipe' }, options))
    .toString()
    .replace(/\n$/, '')
}

function title (str) {
  const options = { stdio: [0, 1, 2] }
  const line = ''.padStart(str.length, '=')

  execSync(`echo "${color.CYAN}${line}${color.NONE}"`, options)
  execSync(`echo "${color.CYAN}${str}${color.NONE}"`, options)
  execSync(`echo "${color.CYAN}${line}${color.NONE}"`, options)
}
