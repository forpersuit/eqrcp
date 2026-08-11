const fs = require('fs');

async function runTest() {
  console.log('🚀 Starting EQT Feedback Worker Local Integration Test...');

  // 1. Prepare payload with dummy WebP image base64
  const dummyWebpBase64 = 'data:image/webp;base64,UklGRhoAAABXRUJQVlA4TA0AAAAvAAAAEAcQERGIiP4HAA==';
  
  const payload = {
    category: 'bug',
    contact: 'tester@eqt.net.im',
    message: 'Test message: feedback system upgrade works! [Diagnostics]\nplatform: test-env',
    timestamp: new Date().toISOString(),
    imageData: dummyWebpBase64,
    imageFormat: 'image/webp',
    clientInfo: {
      version: 'v1.7.97-test',
      os: 'linux/amd64'
    }
  };

  console.log('📥 Sending POST request to http://127.0.0.1:8787/goal ...');
  try {
    const postResponse = await fetch('http://127.0.0.1:8787/goal', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(payload)
    });

    if (!postResponse.ok) {
      const errText = await postResponse.text();
      throw new Error(`POST failed: ${postResponse.status} - ${errText}`);
    }

    const postResult = await postResponse.json();
    console.log('✅ POST Success! Result:', postResult);

    if (!postResult.imageUrl) {
      throw new Error('POST response does not contain imageUrl');
    }

    // 2. Fetch the image from local dev server using the key
    const url = new URL(postResult.imageUrl);
    const localImageUrl = `http://127.0.0.1:8787${url.pathname}`;
    console.log(`📤 Fetching image from local url: ${localImageUrl} ...`);

    const imageResponse = await fetch(localImageUrl);
    if (!imageResponse.ok) {
      throw new Error(`GET image failed: ${imageResponse.status}`);
    }

    const imageBuffer = await imageResponse.arrayBuffer();
    console.log(`✅ GET Image Success! Retrieved ${imageBuffer.byteLength} bytes.`);
    console.log('🎉 All integration tests passed successfully!');

  } catch (error) {
    console.error('❌ Test failed:', error);
    process.exit(1);
  }
}

runTest();
