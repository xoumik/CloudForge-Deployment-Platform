const express = require('express')
const httpProxy = require('http-proxy')

const app = express()
const PORT = 8000

const BASE_PATH = 'https://cloudforge-output-bucket.s3.ap-south-2.amazonaws.com/__outputs'

const proxy = httpProxy.createProxy()

app.use((req, res) => {
    const hostname = req.hostname;
    const subdomain = hostname.split('.')[0];

    if (!subdomain || subdomain === 'localhost') {
        return res.status(400).send('Invalid Project Subdomain');
    }

    const resolvesTo = `${BASE_PATH}/${subdomain}`

    // Proxy the request to S3
    return proxy.web(req, res, { target: resolvesTo, changeOrigin: true })
})

// Rewrite root path to index.html
proxy.on('proxyReq', (proxyReq, req, res) => {
    const url = req.url;
    if (url === '/') {
        proxyReq.path += 'index.html'
    }
})

proxy.on('error', (err, req, res) => {
    console.error('Proxy Error:', err.message);
    if (!res.headersSent) {
        res.status(500).send('Deployment not found or internal server error.');
    }
});

app.listen(PORT, () => console.log(`Reverse Proxy Running on port ${PORT}`))