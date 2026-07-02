const { spawn } = require('child_process');
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PORT = 18081;
const DOWNLOAD_DIR = path.join(__dirname, '../test_downloads_multi');

function cleanup() {
    if (fs.existsSync(DOWNLOAD_DIR)) {
        fs.rmSync(DOWNLOAD_DIR, { recursive: true, force: true });
    }
    fs.mkdirSync(DOWNLOAD_DIR, { recursive: true });
}

function base64Encode(str) {
    return Buffer.from(str).toString('base64');
}

// Global host of the server
let serverHost = '127.0.0.1';

function makeRequest(options, chunkData = null) {
    if (options.hostname === '127.0.0.1') {
        options.hostname = serverHost;
    }
    return new Promise((resolve, reject) => {
        const req = http.request(options, (res) => {
            let body = '';
            res.setEncoding('utf8');
            res.on('data', (chunk) => { body += chunk; });
            res.on('end', () => {
                resolve({
                    statusCode: res.statusCode,
                    headers: res.headers,
                    body: body
                });
            });
        });
        req.on('error', reject);
        if (chunkData) {
            req.write(chunkData);
        }
        req.end();
    });
}

async function runSimulation() {
    console.log("=================================================");
    console.log("=== STARTING MULTI-DEVICE E2E SIMULATION TEST ===");
    console.log("=================================================");
    cleanup();

    // 1. Start EQT Server
    console.log(`[Config] Starting EQT Receiver on port ${PORT}...`);
    const serverProcess = spawn('go', ['run', './cmd/eqt', 'receive', '--output', DOWNLOAD_DIR, '--port', PORT.toString(), '--keep-alive'], {
        cwd: path.join(__dirname, '..')
    });

    let receivePathToken = null;

    // Capture start URL
    await new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
            serverProcess.kill();
            reject(new Error("Timeout waiting for server stdout."));
        }, 15000);

        serverProcess.stdout.on('data', (data) => {
            const output = data.toString();
            console.log(`[EQT Server]: ${output.trim()}`);
            const match = output.match(/http:\/\/([a-zA-Z0-9.-]+):\d+\/receive\/([a-zA-Z0-9_-]+)/);
            if (match) {
                serverHost = match[1];
                receivePathToken = match[2];
                console.log(`[Parsed] Host: ${serverHost}, Token: ${receivePathToken}`);
                clearTimeout(timeout);
                resolve();
            }
        });

        serverProcess.stderr.on('data', (data) => {
            // Log backend logs
            console.log(`[EQT Backend Logs]: ${data.toString().trim()}`);
        });
    });

    // 2. Prepare mock data
    // Device A (client_A): 1 file (small_a.txt, 40KB)
    const clientA = "client_device_A";
    const dataA = crypto.randomBytes(40 * 1024);
    const sizeA = dataA.length;

    // Device B (client_B): 1 file (large_b.bin, 800KB)
    const clientB = "client_device_B";
    const dataB = crypto.randomBytes(800 * 1024);
    const sizeB = dataB.length;

    // 3. Start a status poller (simulating Wails GUI drawing task progress)
    let pollerActive = true;
    const progressHistory = [];
    const pollStatus = async () => {
        while (pollerActive) {
            try {
                const res = await makeRequest({
                    hostname: '127.0.0.1',
                    port: PORT,
                    path: `/send/${receivePathToken}/status`,
                    method: 'GET'
                });
                if (res.statusCode === 200) {
                    const statusObj = JSON.parse(res.body);
                    progressHistory.push(statusObj);
                }
            } catch (e) {
                // ignore transient socket errors
            }
            await new Promise(r => setTimeout(r, 150));
        }
    };
    const pollPromise = pollStatus();

    // 4. Trigger concurrent upload workflows
    console.log("\n[Simulating] Device A & Device B initiating Tus Handshakes...");

    // Device A Handshake
    const metaA = `filename ${base64Encode('small_a.txt')},clientid ${base64Encode(clientA)},totalsize ${base64Encode(sizeA.toString())},totalfiles ${base64Encode('1')}`;
    let resA = await makeRequest({
        hostname: '127.0.0.1',
        port: PORT,
        path: `/receive/${receivePathToken}/tus/`,
        method: 'POST',
        headers: {
            'Tus-Resumable': '1.0.0',
            'Upload-Length': sizeA.toString(),
            'Upload-Metadata': metaA,
            'Cookie': `eqt_client_id=${clientA}`,
            'User-Agent': 'Mozilla/5.0 (Linux; Android 10)'
        }
    });
    const locA = resA.headers.location;
    console.log(`[Device A] Resource established: ${locA}`);

    // Device B Handshake
    const metaB = `filename ${base64Encode('large_b.bin')},clientid ${base64Encode(clientB)},totalsize ${base64Encode(sizeB.toString())},totalfiles ${base64Encode('1')}`;
    let resB = await makeRequest({
        hostname: '127.0.0.1',
        port: PORT,
        path: `/receive/${receivePathToken}/tus/`,
        method: 'POST',
        headers: {
            'Tus-Resumable': '1.0.0',
            'Upload-Length': sizeB.toString(),
            'Upload-Metadata': metaB,
            'Cookie': `eqt_client_id=${clientB}`,
            'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 13_2_3 like Mac OS X)'
        }
    });
    const locB = resB.headers.location;
    console.log(`[Device B] Resource established: ${locB}`);

    // Start uploading data
    console.log("\n[Simulating] Concurrent chunk transfers...");

    // Device A uploads fully
    console.log("[Device A] Uploading small_a.txt...");
    await makeRequest({
        hostname: '127.0.0.1',
        port: PORT,
        path: locA,
        method: 'PATCH',
        headers: {
            'Tus-Resumable': '1.0.0',
            'Upload-Offset': '0',
            'Content-Type': 'application/offset+octet-stream',
            'Cookie': `eqt_client_id=${clientA}`,
            'User-Agent': 'Mozilla/5.0 (Linux; Android 10)'
        }
    }, dataA);
    console.log("[Device A] small_a.txt data upload finished.");

    // Device B uploads first chunk (300KB) and simulates drop
    console.log("[Device B] Uploading first block (300KB of 800KB)...");
    const blockB1 = dataB.slice(0, 300 * 1024);
    await makeRequest({
        hostname: '127.0.0.1',
        port: PORT,
        path: locB,
        method: 'PATCH',
        headers: {
            'Tus-Resumable': '1.0.0',
            'Upload-Offset': '0',
            'Content-Type': 'application/offset+octet-stream',
            'Cookie': `eqt_client_id=${clientB}`,
            'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 13_2_3 like Mac OS X)'
        }
    }, blockB1);
    console.log("[Device B] Network dropped intentionally.");

    // Give time to poller to capture state
    await new Promise(r => setTimeout(r, 400));

    // Device B performs HEAD query for offset validation
    console.log("[Device B] Reconnecting... Querying Offset via HEAD...");
    const headRes = await makeRequest({
        hostname: '127.0.0.1',
        port: PORT,
        path: locB,
        method: 'HEAD',
        headers: {
            'Tus-Resumable': '1.0.0',
            'Cookie': `eqt_client_id=${clientB}`,
            'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 13_2_3 like Mac OS X)'
        }
    });
    const offsetB = parseInt(headRes.headers['upload-offset'], 10);
    console.log(`[Device B] Verified offset on EQT Server is ${offsetB} bytes (Expected: 307200)`);

    // Device B uploads the remaining block (500KB)
    console.log("[Device B] Resuming remaining data upload (300KB to 800KB)...");
    const blockB2 = dataB.slice(300 * 1024);
    await makeRequest({
        hostname: '127.0.0.1',
        port: PORT,
        path: locB,
        method: 'PATCH',
        headers: {
            'Tus-Resumable': '1.0.0',
            'Upload-Offset': offsetB.toString(),
            'Content-Type': 'application/offset+octet-stream',
            'Cookie': `eqt_client_id=${clientB}`,
            'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 13_2_3 like Mac OS X)'
        }
    }, blockB2);
    console.log("[Device B] large_b.bin upload finished.");

    // Send final archiving notification
    console.log("\n[Simulating] Finalizing transactions...");
    await makeRequest({
        hostname: '127.0.0.1',
        port: PORT,
        path: `/receive/${receivePathToken}?done=true`,
        method: 'POST',
        headers: { 'Cookie': `eqt_client_id=${clientA}` }
    });
    await makeRequest({
        hostname: '127.0.0.1',
        port: PORT,
        path: `/receive/${receivePathToken}?done=true`,
        method: 'POST',
        headers: { 'Cookie': `eqt_client_id=${clientB}` }
    });

    // Stop status poller
    pollerActive = false;
    await pollPromise;

    console.log("\n--- Verification and Integrity Results ---");
    const destA = path.join(DOWNLOAD_DIR, 'small_a.txt');
    const destB = path.join(DOWNLOAD_DIR, 'large_b.bin');

    if (!fs.existsSync(destA) || !fs.existsSync(destB)) {
        throw new Error("Simulation failed: Missing files in downloads directory.");
    }

    const verifyA = fs.readFileSync(destA);
    const verifyB = fs.readFileSync(destB);

    if (!verifyA.equals(dataA) || !verifyB.equals(dataB)) {
        throw new Error("Simulation failed: File content corruption observed.");
    }
    console.log("✓ File Integrity verification: PASSED (No corruption, perfect hashes).");

    // Print progress timeline mapped from server status updates
    console.log("\n--- Timeline of Wails GUI Progress States (State Trees) ---");
    
    // We group records to see status transitions
    let lastLogged = "";
    for (const snap of progressHistory) {
        const stateKeys = Object.keys(snap.clientStates || {});
        let logStr = `Global State: ${snap.state} | Active Devices: ${stateKeys.length}`;
        for (const cid of stateKeys) {
            const dev = snap.clientStates[cid];
            logStr += `\n   -> [${cid}] (DeviceName: ${dev.deviceName}) file="${dev.current || 'Done'}" progress=${dev.bytesDone}/${dev.bytesTotal} (${dev.percent}%) state=${dev.state}`;
            if (dev.files && dev.files.length > 0) {
                dev.files.forEach(f => {
                    logStr += `\n      * File: ${f.name} (ID: ${f.fileID}) state=${f.state} progress=${f.bytesDone}/${f.bytesTotal} (${f.percent}%) path=${f.path || ''}`;
                });
            }
        }
        if (logStr !== lastLogged) {
            console.log(`[Time: ${new Date().toISOString().slice(11,19)}] ${logStr}`);
            lastLogged = logStr;
        }
    }

    const finalStatus = progressHistory[progressHistory.length - 1];
    console.log(`\nFinal SavedFiles registered in EQT GUI Status:`, finalStatus.savedFiles);

    console.log("\n=================================================");
    console.log("=== MULTI-DEVICE SIMULATION SUCCESSFULLY PASSED ===");
    console.log("=================================================");

    serverProcess.kill();
    process.exit(0);
}

runSimulation().catch(e => {
    console.error("❌ Simulation Failed:", e.message);
    process.exit(1);
});
