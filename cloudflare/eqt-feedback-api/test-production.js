async function runProductionTest() {
  console.log('🚀 Starting EQT Feedback Worker Production Integration Test...');
  console.log('🔗 Targeting Domain: https://feedback.eqt.net.im/goal');

  // Dummy 1x1 WebP Base64 image
  const dummyWebpBase64 = 'data:image/webp;base64,UklGRhoAAABXRUJQVlA4TA0AAAAvAAAAEAcQERGIiP4HAA==';
  
  const payload = {
    category: 'feature',
    contact: 'tester@eqt.net.im',
    message: '🎉 祝贺！EQT 边缘计算一键反馈与图片上传系统部署及 Telegram Bot 绑定测试成功！\n此消息为公网真实集成测试推送，包含 WebP 压缩图片，已成功落袋 D1 数据库与 R2 存储桶。',
    timestamp: new Date().toISOString(),
    imageData: dummyWebpBase64,
    imageFormat: 'image/webp',
    clientInfo: {
      version: 'v1.7.97-production-test',
      os: 'linux/amd64'
    }
  };

  console.log('📥 Sending POST request to production custom domain ...');
  try {
    const postResponse = await fetch('https://feedback.eqt.net.im/goal', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(payload)
    });

    if (!postResponse.ok) {
      const errText = await postResponse.text();
      throw new Error(`Production POST failed: ${postResponse.status} - ${errText}`);
    }

    const postResult = await postResponse.json();
    console.log('✅ Production POST Success! Response:', postResult);

    if (!postResult.imageUrl) {
      throw new Error('Production response does not contain imageUrl');
    }

    console.log(`📤 Generated WebP Image CDN URL: ${postResult.imageUrl}`);
    console.log('⏳ Checking image fetch from custom domain ...');

    const imageResponse = await fetch(postResult.imageUrl);
    if (!imageResponse.ok) {
      throw new Error(`Production GET image failed: ${imageResponse.status}`);
    }

    const imageBuffer = await imageResponse.arrayBuffer();
    console.log(`✅ Production GET Image Success! Retrieved ${imageBuffer.byteLength} bytes.`);
    console.log('🎉 Production custom domain and Telegram notification system test passed successfully!');

  } catch (error) {
    console.error('❌ Production test failed:', error);
    process.exit(1);
  }
}

runProductionTest();
