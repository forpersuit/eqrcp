// 推广分享海报与弹窗独立模块 (Share Poster & Share Overlay Component)

function isOnline() {
    return typeof navigator !== 'undefined' ? navigator.onLine : true;
}

// 纯 Base64 编码的 SVG 占位图，杜绝未编码双引号破坏 HTML 属性
export const placeholderQRSvg = 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIyNDAiIGhlaWdodD0iMjQwIiB2aWV3Qm94PSIwIDAgMjQgMjQiIGZpbGw9Im5vbmUiIHN0cm9rZT0iIzE2YTM0YSIgc3Ryb2tlLXdpZHRoPSIxLjUiPjxyZWN0IHg9IjMiIHk9IjMiIHdpZHRoPSIxOCIgaGVpZ2h0PSIxOCIgcng9IjIiPjwvcmVjdD48cmVjdCB4PSI3IiB5PSI3IiB3aWR0aD0iMyIgaGVpZ2h0PSIzIj48L3JlY3Q+PHJlY3QgeD0iMTQiIHk9IjciIHdpZHRoPSIzIiBoZWlnaHQ9IjMiPjwvcmVjdD48cmVjdCB4PSI3IiB5PSIxNCIgd2lkdGg9IjMiIGhlaWdodD0iMyI+PC9yZWN0Pjwvc3ZnPg==';

let cachedMergedQRDataURL = '';
let isPreparingQR = false;
let qrPrepareFailed = false;

function generateRandomScatteredIcons() {
    const iconList = ['📷', '🎥', '🎵', '📄', '💻', '⚡', '📱', '🖼️', '🎬', '🎧', '📁', '💬', '🚀'];
    const shuffled = [...iconList].sort(() => Math.random() - 0.5).slice(0, 8);
    
    const zones = [
        { top: 10 + Math.floor(Math.random() * 12), left: 10 + Math.floor(Math.random() * 18) },
        { top: 12 + Math.floor(Math.random() * 12), right: 10 + Math.floor(Math.random() * 18) },
        { top: 90 + Math.floor(Math.random() * 25), left: 8 + Math.floor(Math.random() * 12) },
        { top: 95 + Math.floor(Math.random() * 25), right: 8 + Math.floor(Math.random() * 12) },
        { top: 175 + Math.floor(Math.random() * 20), left: 12 + Math.floor(Math.random() * 15) },
        { top: 180 + Math.floor(Math.random() * 20), right: 12 + Math.floor(Math.random() * 15) },
        { bottom: 20 + Math.floor(Math.random() * 15), left: 10 + Math.floor(Math.random() * 20) },
        { bottom: 18 + Math.floor(Math.random() * 15), right: 10 + Math.floor(Math.random() * 20) }
    ];

    return shuffled.map((icon, idx) => {
        const zone = zones[idx];
        const size = 18 + Math.floor(Math.random() * 14);
        const rotate = -30 + Math.floor(Math.random() * 60);
        const opacity = (0.22 + Math.random() * 0.15).toFixed(2);
        
        let posStyle = '';
        if (zone.top !== undefined) posStyle += `top: ${zone.top}px; `;
        if (zone.bottom !== undefined) posStyle += `bottom: ${zone.bottom}px; `;
        if (zone.left !== undefined) posStyle += `left: ${zone.left}px; `;
        if (zone.right !== undefined) posStyle += `right: ${zone.right}px; `;

        return `<span class="scattered-icon" style="${posStyle} font-size: ${size}px; transform: rotate(${rotate}deg); opacity: ${opacity};">${icon}</span>`;
    }).join('');
}

function downloadIcon() {
    return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="7 10 12 15 17 10"></polyline><line x1="12" y1="15" x2="12" y2="3"></line></svg>';
}

function copyIcon() {
    return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>';
}

function loadImageElement(src) {
    return new Promise((resolve) => {
        const img = new Image();
        img.crossOrigin = 'anonymous';
        img.onload = () => resolve(img);
        img.onerror = () => resolve(null);
        img.src = src;
    });
}

export async function getMergedQRCodeDataURL(text, logoSrc) {
    const canvas = document.createElement('canvas');
    const size = 360;
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d');

    // 1. 优先使用本地 Go 后端 100% 离线生成高容错 (ecc=H) 二维码 (零网络依赖, 断网毫秒级秒出)
    let qrDataUrl = '';
    if (window.go?.main?.App?.GenerateQRCodePNG) {
        try {
            qrDataUrl = await window.go.main.App.GenerateQRCodePNG(text || 'https://www.eqt.net.im', size);
        } catch (e) {
            console.warn('[EQT Share] Native QR code generation failed:', e);
        }
    }
    if (typeof qrDataUrl !== 'string' || !qrDataUrl) {
        qrDataUrl = '';
    }
    // 2. 本地生成不可用时, 仅在线降级到第三方在线 QR API
    if (!qrDataUrl && isOnline()) {
        qrDataUrl = `https://api.qrserver.com/v1/create-qr-code/?size=${size}x${size}&ecc=H&data=${encodeURIComponent(text || 'https://www.eqt.net.im')}`;
    }

    if (!qrDataUrl) {
        return null;
    }
    const qrImg = await loadImageElement(qrDataUrl);
    if (!qrImg || qrImg.naturalWidth === 0) {
        return null;
    }
    ctx.drawImage(qrImg, 0, 0, size, size);

    // 3. 在二维码正中间物理绘制品牌 Logo 徽章
    if (logoSrc) {
        const logoImg = await loadImageElement(logoSrc);
        if (logoImg && logoImg.naturalWidth > 0) {
            const logoSize = Math.floor(size * 0.22);
            const x = (size - logoSize) / 2;
            const y = (size - logoSize) / 2;
            const pad = 6;

            ctx.fillStyle = '#ffffff';
            ctx.beginPath();
            ctx.roundRect(x - pad, y - pad, logoSize + pad * 2, logoSize + pad * 2, 12);
            ctx.fill();
            ctx.strokeStyle = 'rgba(0,0,0,0.08)';
            ctx.lineWidth = 2;
            ctx.stroke();

            ctx.drawImage(logoImg, x, y, logoSize, logoSize);
        }
    }

    return canvas.toDataURL('image/png');
}

export async function prepareMergedQRCode(faviconURL, renderCallback) {
    if (cachedMergedQRDataURL) {
        return cachedMergedQRDataURL;
    }
    if (isPreparingQR) {
        return '';
    }
    isPreparingQR = true;
    try {
        cachedMergedQRDataURL = await getMergedQRCodeDataURL('https://www.eqt.net.im', faviconURL);
        if (cachedMergedQRDataURL) {
            qrPrepareFailed = false;
            const imgEl = document.querySelector('#share-qr-img-element');
            if (imgEl) {
                imgEl.src = cachedMergedQRDataURL;
            }
            document.querySelector('.share-qr-wrapper .qr-failed-tip')?.remove();
        } else {
            qrPrepareFailed = true;
            if (typeof renderCallback === 'function') {
                renderCallback();
            }
        }
    } catch (e) {
        qrPrepareFailed = true;
        console.error('[EQT Share] Failed to prepare merged QR code:', e);
    } finally {
        isPreparingQR = false;
    }
    return cachedMergedQRDataURL;
}

export async function downloadSharePosterImage(horizontalLogoURL, faviconURL, state, t, renderCallback, escapeHTML) {
    try {
        const posterEl = document.querySelector('.share-poster-card');
        const rect = posterEl ? posterEl.getBoundingClientRect() : { width: 300, height: 350 };
        const width = Math.round(rect.width) || 300;
        const height = Math.round(rect.height) || 350;
        const scale = window.devicePixelRatio || 2;
        
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');
        canvas.width = width * scale;
        canvas.height = height * scale;
        ctx.scale(scale, scale);

        // 1. 绘制纯白底色与浅色圆角边框
        ctx.fillStyle = '#ffffff';
        ctx.beginPath();
        ctx.roundRect(0, 0, width, height, 22);
        ctx.fill();

        ctx.strokeStyle = 'rgba(0, 0, 0, 0.08)';
        ctx.lineWidth = 1;
        ctx.stroke();

        // 2. 绘制散落文件图标
        const iconList = ['📷', '🎥', '🎵', '📄', '💻', '⚡', '📱', '🖼️', '🎬', '🎧', '📁', '💬', '🚀'];
        const shuffled = [...iconList].sort(() => Math.random() - 0.5).slice(0, 8);
        const coords = [
            { x: Math.round(width * 0.09), y: Math.round(height * 0.08), size: 20, rot: -0.3 },
            { x: Math.round(width * 0.91), y: Math.round(height * 0.09), size: 24, rot: 0.25 },
            { x: Math.round(width * 0.07), y: Math.round(height * 0.42), size: 18, rot: 0.4 },
            { x: Math.round(width * 0.93), y: Math.round(height * 0.45), size: 22, rot: -0.2 },
            { x: Math.round(width * 0.10), y: Math.round(height * 0.75), size: 20, rot: -0.35 },
            { x: Math.round(width * 0.90), y: Math.round(height * 0.77), size: 19, rot: 0.3 },
            { x: Math.round(width * 0.15), y: Math.round(height * 0.93), size: 18, rot: -0.15 },
            { x: Math.round(width * 0.85), y: Math.round(height * 0.94), size: 18, rot: 0.2 }
        ];

        ctx.fillStyle = 'rgba(5, 150, 105, 0.25)';
        shuffled.forEach((icon, i) => {
            const c = coords[i];
            ctx.save();
            ctx.translate(c.x, c.y);
            ctx.rotate(c.rot);
            ctx.font = `${c.size}px "Segoe UI Emoji", "Apple Color Emoji", sans-serif`;
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText(icon, 0, 0);
            ctx.restore();
        });

        // 3. 计算居中布局
        const qrSize = 175;
        const gap = 20;
        const logoBoxW = 175;
        const logoBoxH = 48;

        const featImage = await loadImageElement(horizontalLogoURL);
        const imgRatio = featImage ? (featImage.width / (featImage.height || 1)) : 3.6;
        let featWidth = logoBoxW;
        let featHeight = featWidth / imgRatio;
        if (featHeight > logoBoxH) {
            featHeight = logoBoxH;
            featWidth = featHeight * imgRatio;
        }
        const contentH = qrSize + gap + featHeight;
        const qrX = (width - qrSize) / 2;
        const qrY = Math.max(Math.round((height - contentH) / 2), 8);
        const featY = qrY + qrSize + gap;

        // 4. 绘制二维码
        const qrDataUrl = await getMergedQRCodeDataURL('https://www.eqt.net.im', faviconURL);
        if (qrDataUrl) {
            cachedMergedQRDataURL = cachedMergedQRDataURL || qrDataUrl;
            qrPrepareFailed = false;
            const qrMergedImg = await loadImageElement(qrDataUrl);
            if (qrMergedImg && qrMergedImg.naturalWidth > 0) {
                ctx.save();
                ctx.beginPath();
                ctx.roundRect(qrX, qrY, qrSize, qrSize, 8);
                ctx.clip();
                ctx.drawImage(qrMergedImg, qrX, qrY, qrSize, qrSize);
                ctx.restore();
            }
        }

        // 5. 绘制下方 Logo
        if (featImage) {
            ctx.drawImage(featImage, (width - featWidth) / 2, featY, featWidth, featHeight);
        }

        // 6. 保存图片
        const dataUrl = canvas.toDataURL('image/png');
        if (window.go?.main?.App?.SaveSharePosterImage) {
            const savedPath = await window.go.main.App.SaveSharePosterImage(dataUrl);
            if (!savedPath) {
                return;
            }
        } else {
            const link = document.createElement('a');
            link.download = 'EQT-Share-Poster.png';
            link.href = dataUrl;
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
        }

        // 7. 成功提示
        const downloadBtn = document.querySelector('#download-share-poster-btn');
        if (downloadBtn) {
            downloadBtn.classList.add('success-saved');
            downloadBtn.innerHTML = `
                <span style="display: flex; align-items: center; justify-content: center;">✓</span>
                <span>${escapeHTML(t('poster_saved_success') || '已成功保存')}</span>
            `;
            setTimeout(() => {
                if (downloadBtn) {
                    downloadBtn.classList.remove('success-saved');
                    downloadBtn.innerHTML = `
                        <span style="display: flex; align-items: center; justify-content: center;">${downloadIcon()}</span>
                        <span>${escapeHTML(t('download_share_poster') || '保存推广海报')}</span>
                    `;
                }
            }, 3000);
        }

        state.notice = t('poster_downloaded') || '推广海报图片已成功保存！';
        if (typeof renderCallback === 'function') {
            renderCallback();
        }
    } catch (e) {
        console.error('Failed to download share poster image:', e);
    }
}

export function closeShareOverlay(state, renderCallback) {
    if (state && state.showShareOverlay) {
        state.showShareOverlay = false;
        if (typeof renderCallback === 'function') {
            renderCallback();
        }
    }
}

export function renderShareOverlay(state, t, escapeAttr, escapeHTML, horizontalLogoURL, faviconURL, renderCallback) {
    if (!state || !state.showShareOverlay) {
        return '';
    }

    const scatteredHtml = generateRandomScatteredIcons();
    const qrSrc = cachedMergedQRDataURL || placeholderQRSvg;

    if (!cachedMergedQRDataURL && !isPreparingQR && !qrPrepareFailed) {
        setTimeout(() => prepareMergedQRCode(faviconURL, renderCallback), 0);
    }

    return `
        <div class="share-overlay-backdrop" id="share-overlay-backdrop" role="presentation">
            <div class="share-overlay-modal" role="dialog" aria-modal="true">
                <button type="button" class="share-overlay-close" id="close-share-overlay" title="${escapeAttr(t('close') || '关闭')}" aria-label="${escapeAttr(t('close') || '关闭')}">x</button>
                <div class="share-panel" style="padding: 2px 2px 8px 2px;">
                    <div class="share-poster-card">
                        <div class="share-scattered-bg">
                            ${scatteredHtml}
                        </div>

                        <div class="share-poster-content" style="gap: 20px;">
                            <div class="share-qr-wrapper">
                                <img class="share-qr-img" id="share-qr-img-element" src="${escapeAttr(qrSrc)}" alt="EQT Website QR Code" />
                                ${qrPrepareFailed ? `<div class="qr-failed-tip" style="margin-top: 8px; text-align: center; font-size: 11px; color: var(--danger, #b42318);">${escapeHTML(t('qr_generate_failed_tip') || '二维码生成失败（离线且本地生成不可用），请联网重试')}</div>` : ''}
                            </div>

                            <div class="share-illustration-box">
                                <img src="${horizontalLogoURL}" alt="EQT Logo Illustration" />
                            </div>
                        </div>
                    </div>

                    <div class="share-actions-group">
                        <button type="button" class="share-action-btn primary" id="download-share-poster-btn" title="${escapeAttr(t('download_share_poster') || '保存推广海报')}">
                            <span style="display: flex; align-items: center; justify-content: center;">${downloadIcon()}</span>
                            <span>${escapeHTML(t('download_share_poster') || '保存推广海报')}</span>
                        </button>
                        <button type="button" class="share-action-btn" id="copy-share-url-btn" title="${escapeAttr(t('copy_share_url') || '复制官网链接')}">
                            <span style="display: flex; align-items: center; justify-content: center;">${copyIcon()}</span>
                            <span>${escapeHTML(t('copy_share_url') || '复制官网链接')}</span>
                        </button>
                    </div>
                </div>
            </div>
        </div>
    `;
}

export function bindShareEvents(state, t, escapeHTML, horizontalLogoURL, faviconURL, renderCallback) {
    if (!state || !state.showShareOverlay) {
        return;
    }

    // 1. 关闭按钮点击 (单向数据流受控触发 renderCallback，0ms 极速响应)
    document.querySelector('#close-share-overlay')?.addEventListener('click', (e) => {
        e.stopPropagation();
        closeShareOverlay(state, renderCallback);
    });

    // 2. 遮罩层背景点击
    document.querySelector('#share-overlay-backdrop')?.addEventListener('click', (e) => {
        if (e.target.id === 'share-overlay-backdrop' || e.target.classList.contains('share-overlay-backdrop')) {
            e.stopPropagation();
            closeShareOverlay(state, renderCallback);
        }
    });

    // 3. 下载海报按钮
    document.querySelector('#download-share-poster-btn')?.addEventListener('click', () => {
        downloadSharePosterImage(horizontalLogoURL, faviconURL, state, t, renderCallback, escapeHTML);
    });

    // 4. 复制官网链接按钮
    document.querySelector('#copy-share-url-btn')?.addEventListener('click', async () => {
        const url = 'https://www.eqt.net.im';
        try {
            if (navigator.clipboard && navigator.clipboard.writeText) {
                await navigator.clipboard.writeText(url);
            }
            state.notice = t('share_url_copied') || '官网链接已成功复制到剪贴板！';
            if (typeof renderCallback === 'function') {
                renderCallback();
            }
        } catch (_) {
            state.notice = url;
            if (typeof renderCallback === 'function') {
                renderCallback();
            }
        }
    });
}
