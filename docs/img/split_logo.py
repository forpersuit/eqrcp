import os
from PIL import Image

def split_and_clean_assets(file_path):
    if not os.path.exists(file_path):
        print(f"错误: 找不到文件 {file_path}")
        return

    # 加载图片并转换为 RGBA (带透明度通道)
    img = Image.open(file_path).convert("RGBA")
    width, height = img.size

    # 重新定义的精准坐标 (基于 1000x1000 比例的百分比)
    # 格式: [左, 上, 右, 下]
    zones = {
        "logo_mark_main": [30, 30, 550, 550],       # 左上大图形
        "app_icon_dark": [625, 30, 970, 375],       # 右上深色方块图标
        "app_icon_light": [625, 375, 970, 720],     # 右中浅色方块图标
        "brand_horizontal": [180, 770, 850, 980],   # 底部 EQT 文字组合
        "icon_32px_dark": [135, 605, 235, 705],     # 小尺寸 32px 深色
        "icon_32px_light": [545, 605, 645, 705]     # 小尺寸 32px 浅色
    }

    output_dir = "final_assets"
    os.makedirs(output_dir, exist_ok=True)

    for name, box in zones.items():
        # 1. 计算实际像素坐标
        left = int(box[0] * width / 1000)
        top = int(box[1] * height / 1000)
        right = int(box[2] * width / 1000)
        bottom = int(box[3] * height / 1000)
        
        # 2. 裁剪
        cropped = img.crop((left, top, right, bottom))
        
        # 3. 智能背景透明化 (去除白色背景)
        # 只有在处理非深色背景图标时才需要此操作
        if "dark" not in name:
            datas = cropped.getdata()
            new_data = []
            for item in datas:
                # 如果 R, G, B 都大于 250 (接近纯白)，则设为透明
                if item[0] > 250 and item[1] > 250 and item[2] > 250:
                    new_data.append((255, 255, 255, 0))
                else:
                    new_data.append(item)
            cropped.putdata(new_data)

        # 4. 保存
        save_path = f"{output_dir}/{name}.png"
        cropped.save(save_path, "PNG")
        print(f"成功保存: {save_path} ({cropped.size[0]}x{cropped.size[1]})")

if __name__ == "__main__":
    split_and_clean_assets('logo-design.png')