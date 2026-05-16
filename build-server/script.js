const { exec } = require('child_process')
const path = require('path')
const fs = require('fs')
const { S3Client, PutObjectCommand } = require('@aws-sdk/client-s3')
const mime = require('mime-types')
const Redis = require('ioredis')

const region = process.env.AWS_REGION || process.env.AWS_DEFAULT_REGION
const bucket = process.env.S3_OUTPUT_BUCKET
const REDIS_URL = process.env.REDIS_URL
const PROJECT_ID = process.env.PROJECT_ID

if (!region || !bucket) {
    console.error('Set AWS_REGION (or AWS_DEFAULT_REGION) and S3_OUTPUT_BUCKET')
    process.exit(1)
}

if (!PROJECT_ID) {
    console.error('PROJECT_ID is required')
    process.exit(1)
}

const s3Client = new S3Client({ region })
const publisher = REDIS_URL ? new Redis(REDIS_URL) : null

function publishLog(log) {
    const message = typeof log === 'string' ? log.trim() : String(log)
    if (!message) return
    if (publisher) {
        publisher.publish(`logs:${PROJECT_ID}`, JSON.stringify({ log: message }))
    }
}

function fail(message, code = 1) {
    publishLog(message)
    console.error(message)
    process.exit(code)
}

async function init() {
    publishLog('Build started')
    console.log('Executing script.js')
    const outDirPath = path.join(__dirname, 'output')

    const p = exec(`cd ${outDirPath} && npm install && npm run build`)

    p.stdout.on('data', function (data) {
        console.log(data.toString())
        publishLog(data.toString())
    })

    p.stderr.on('data', function (data) {
        console.error(data.toString())
        publishLog(`error: ${data.toString()}`);
    })

    p.on('error', function (err) {
        fail(`Failed to start build: ${err.message}`)
    })

    p.on('close', async function (code) {
        if (code !== 0) {
            fail(`Build failed with exit code ${code}`, code ?? 1)
        }

        publishLog('Build finished, uploading artifacts to S3')
        console.log('Build complete')

        const distFolderPath = path.join(__dirname, 'output', 'dist')
        if (!fs.existsSync(distFolderPath)) {
            fail(`dist folder not found: ${distFolderPath}`)
        }

        const distFolderContents = fs.readdirSync(distFolderPath, { recursive: true })

        try {
            const uploadPromises = []
            for (const file of distFolderContents) {
                const filePath = path.join(distFolderPath, file)
                if (fs.lstatSync(filePath).isDirectory()) continue

                publishLog(`uploading ${file}`)
                console.log('uploading', filePath)

                const command = new PutObjectCommand({
                    Bucket: bucket,
                    Key: `__outputs/${PROJECT_ID}/${file}`,
                    Body: fs.createReadStream(filePath),
                    ContentType: mime.lookup(filePath) || 'application/octet-stream',
                })

                const uploadTask = s3Client.send(command).then(() => {
                    publishLog(`uploaded ${file}`)
                    console.log('uploaded', filePath)
                })

                uploadPromises.push(uploadTask)
            }

            await Promise.all(uploadPromises)
            publishLog('Build complete')
            console.log('Done...')
        } catch (err) {
            fail(`Upload failed: ${err.message}`)
        }
    })
}

init()