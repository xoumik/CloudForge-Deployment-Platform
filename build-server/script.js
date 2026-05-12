const { exec } = require('child_process')
const path = require('path')
const fs = require('fs')
const { S3Client, PutObjectCommand } = require('@aws-sdk/client-s3')
const mime = require('mime-types')

const region = process.env.AWS_REGION || process.env.AWS_DEFAULT_REGION
const bucket = process.env.S3_OUTPUT_BUCKET

if (!region || !bucket) {
    console.error('Set AWS_REGION (or AWS_DEFAULT_REGION) and S3_OUTPUT_BUCKET')
    process.exit(1)
}

const s3Client = new S3Client({ region })

const PROJECT_ID = process.env.PROJECT_ID

async function init() {
    console.log('Executing script.js')
    const outDirPath = path.join(__dirname, 'output')

    const p = exec(`cd ${outDirPath} && npm install && npm run build`)

    p.stdout.on('data', function (data) {
        console.log(data.toString())
    })

    p.stderr.on('data', function (data) {
        console.error(data.toString())
    })

    p.on('error', function (err) {
        console.error('Failed to start build:', err)
    })

    p.on('close', async function (code) {
        if (code !== 0) {
            console.error('Build failed with exit code', code)
            process.exit(code ?? 1)
        }
        console.log('Build Complete')

        if (!PROJECT_ID) {
            console.error('PROJECT_ID is required')
            process.exit(1)
        }

        const distFolderPath = path.join(__dirname, 'output', 'dist')
        if (!fs.existsSync(distFolderPath)) {
            console.error('dist folder not found:', distFolderPath)
            process.exit(1)
        }

        const distFolderContents = fs.readdirSync(distFolderPath, { recursive: true })

        try {
            // Upload files to S3 in parallel
            const uploadPromises = [];
            for (const file of distFolderContents) {
                const filePath = path.join(distFolderPath, file)
                if (fs.lstatSync(filePath).isDirectory()) continue

                console.log('uploading', filePath)

                const command = new PutObjectCommand({
                    Bucket: bucket,
                    Key: `__outputs/${PROJECT_ID}/${file}`,
                    Body: fs.createReadStream(filePath),
                    ContentType: mime.lookup(filePath) || 'application/octet-stream',
                })

                const uploadTask = s3Client.send(command).then(() => {
                    console.log('uploaded', filePath)
                });
                
                uploadPromises.push(uploadTask);
            }
            await Promise.all(uploadPromises);
            console.log('Done...')
        } catch (err) {
            console.error('Upload failed:', err)
            process.exit(1)
        }
    })
}

init()