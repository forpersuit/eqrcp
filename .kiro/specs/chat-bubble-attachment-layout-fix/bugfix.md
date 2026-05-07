# Bugfix Requirements Document

## Introduction

在聊天模式下，当消息包含附件（扁平图片或长文件名的文件）时，气泡容器在内部右侧留出不必要的空白区域。这导致气泡边框无法协调地包裹附件内容，影响视觉一致性和用户体验。本修复旨在使气泡边框能够紧密适配附件的实际宽度。

## Bug Analysis

### Current Behavior (Defect)

1.1 WHEN 消息包含扁平图片（宽高比较大的图片）THEN 气泡容器在图片右侧留出空白区域，边框不能适配图片的实际显示宽度

1.2 WHEN 消息包含长文件名的文件附件 THEN 气泡容器在文件卡片右侧留出空白区域，边框不能适配文件卡片的实际宽度

1.3 WHEN 附件卡片的实际内容宽度小于气泡容器的默认宽度 THEN 气泡右侧出现不协调的空白区域

### Expected Behavior (Correct)

2.1 WHEN 消息包含扁平图片（宽高比较大的图片）THEN 气泡边框 SHALL 紧密包裹图片内容，不留出右侧空白区域

2.2 WHEN 消息包含长文件名的文件附件 THEN 气泡边框 SHALL 紧密包裹文件卡片内容，不留出右侧空白区域

2.3 WHEN 附件卡片的实际内容宽度小于气泡容器的默认宽度 THEN 气泡容器 SHALL 自适应收缩以匹配附件卡片的实际宽度

### Unchanged Behavior (Regression Prevention)

3.1 WHEN 消息包含正常比例的图片（非扁平图片）THEN 气泡布局 SHALL CONTINUE TO 正常显示，保持现有的视觉效果

3.2 WHEN 消息包含视频附件 THEN 气泡布局 SHALL CONTINUE TO 正常显示，保持现有的视觉效果

3.3 WHEN 消息包含短文件名的文件附件 THEN 气泡布局 SHALL CONTINUE TO 正常显示，保持现有的视觉效果

3.4 WHEN 消息不包含附件（纯文本消息）THEN 气泡布局 SHALL CONTINUE TO 不受影响，保持现有的文本消息样式

3.5 WHEN 附件卡片达到最大宽度限制（320px for media, 280px for files）THEN 气泡 SHALL CONTINUE TO 正确包裹内容，不超出最大宽度

## Bug Condition Derivation

### Bug Condition Function

```pascal
FUNCTION isBugCondition(X)
  INPUT: X of type MessageWithAttachment
  OUTPUT: boolean
  
  // 当附件卡片的实际渲染宽度小于气泡容器的默认宽度时触发bug
  RETURN X.hasAttachment AND 
         (X.attachmentRenderedWidth < X.bubbleDefaultWidth)
END FUNCTION
```

### Property Specification

```pascal
// Property: Fix Checking - Bubble Width Adaptation
FOR ALL X WHERE isBugCondition(X) DO
  result ← renderBubbleWithAttachment'(X)
  ASSERT result.bubbleWidth ≈ result.attachmentWidth AND
         result.noRightWhitespace AND
         result.borderWrapsContentTightly
END FOR
```

### Preservation Goal

```pascal
// Property: Preservation Checking
FOR ALL X WHERE NOT isBugCondition(X) DO
  ASSERT renderBubbleWithAttachment(X) = renderBubbleWithAttachment'(X)
END FOR
```

这确保对于所有非bug条件的输入（正常比例图片、视频、短文件名、纯文本消息等），修复后的代码行为与原始代码完全一致。
