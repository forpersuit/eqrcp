package server

import (
	"fmt"
	"net/http"
	"regexp"
	"strconv"
)

// RangeInfo 保存从 HTTP Range Header 中解析出的断点续传信息
type RangeInfo struct {
	HasRange  bool  // 是否包含 Range 请求头
	StartByte int64 // 开始的字节偏移量
	EndByte   int64 // 结束的字节偏移量 (如果指定)
}

// ParseRangeHeader 从 http.Request 的 Range 头中解析出断点续传的相关参数
// 支持 bytes=1000- 或 bytes=1000-2000 等标准格式
func ParseRangeHeader(r *http.Request) RangeInfo {
	if r == nil {
		return RangeInfo{}
	}
	rangeHeader := r.Header.Get("Range")
	if rangeHeader == "" {
		return RangeInfo{}
	}

	// 匹配 bytes=start-end 或 bytes=start-
	re := regexp.MustCompile(`bytes=(\d+)-(\d*)`)
	matches := re.FindStringSubmatch(rangeHeader)
	if len(matches) > 1 {
		start, err := strconv.ParseInt(matches[1], 10, 64)
		if err != nil {
			return RangeInfo{}
		}

		info := RangeInfo{
			HasRange:  true,
			StartByte: start,
		}

		if len(matches) > 2 && matches[2] != "" {
			if end, err := strconv.ParseInt(matches[2], 10, 64); err == nil {
				info.EndByte = end
			}
		}
		return info
	}
	return RangeInfo{}
}

// CalculatePercent 辅助函数：根据已完成和总大小计算百分比
func CalculatePercent(done, total int64) int {
	if total <= 0 || done <= 0 {
		return 0
	}
	if done >= total {
		return 100
	}
	percent := (float64(done) / float64(total)) * 100
	return int(percent)
}

// FormatProgressMessage 根据当前状态格式化进度消息
func FormatProgressMessage(state string, done, total int64) string {
	if state == "completed" {
		return "Transfer completed."
	}
	if state == "waiting" {
		return "Transfer interrupted. Waiting for retry..."
	}
	return fmt.Sprintf("Sending file: %d / %d bytes (%d%%)", done, total, CalculatePercent(done, total))
}
