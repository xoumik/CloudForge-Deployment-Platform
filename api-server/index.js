require('dotenv').config();
const express = require('express');
const { generateSlug } = require('random-word-slugs');
const { ECSClient, RunTaskCommand } = require('@aws-sdk/client-ecs');

const app = express();
const port = process.env.PORT || 9000;

// The ECSClient will AUTOMATICALLY use the AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY from .env file. 
// I do not need to explicitly pass them into the constructor!
const ecsClient = new ECSClient({
    region: process.env.AWS_REGION
});

app.use(express.json());

app.post('/project', async (req, res) => {
    const { gitURL } = req.body;
    
    if (!gitURL) {
        return res.status(400).json({ error: 'gitURL is required' });
    }

    const projectSlug = generateSlug();

    const command = new RunTaskCommand({
        cluster: process.env.ECS_CLUSTER_ARN,
        taskDefinition: process.env.ECS_TASK_ARN,
        launchType: 'FARGATE',
        count: 1,
        networkConfiguration: {
            awsvpcConfiguration: {
                assignPublicIp: 'ENABLED',
                subnets: [
                    process.env.SUBNET_1, 
                    process.env.SUBNET_2, 
                    process.env.SUBNET_3
                ],
                securityGroups: [process.env.SECURITY_GROUP]
            }
        },
        overrides: {
            containerOverrides: [
                {
                    name: 'builder-image',
                    environment: [
                        { name: 'GIT_REPOSITORY__URL', value: gitURL },
                        { name: 'PROJECT_ID', value: projectSlug },
                        { name: 'S3_OUTPUT_BUCKET', value: 'cloudforge-output-bucket' },
                        { name: 'AWS_REGION', value: process.env.AWS_REGION }
                        // The IAM Task Role handles S3 permissions natively.
                    ]
                }
            ]
        }
    });

    try {
        await ecsClient.send(command);
        return res.json({ 
            status: 'queued', 
            data: { 
                projectSlug, 
                url: `http://${projectSlug}.localhost:8000` 
            } 
        });
    } catch (error) {
        console.error("Failed to launch ECS task:", error);
        return res.status(500).json({ error: 'Failed to queue deployment' });
    }
});

app.listen(port, () => console.log(`API server is running on port ${port}`));