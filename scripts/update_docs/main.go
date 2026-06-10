package main

import (
	"fmt"
	"os"
	"strings"
)

func main() {
	owner := "李跃龙"
	oldVer := "V1.0"
	newVer := "V1.0.0"

	// 1. Update 00-软著申请计划.md
	updatePlan(oldVer, newVer)

	// 2. Update 01-软件著作权登记申请表.md
	updateApplicationForm(oldVer, newVer, owner)

	// 3. Generate 03-软件设计说明书-李跃龙.md
	generateDesignDoc(oldVer, newVer, owner)

	// 4. Generate 04-软件使用说明书-李跃龙.md
	generateUserDoc(oldVer, newVer, owner)
}

func updatePlan(oldVer, newVer string) {
	path := "软著申请材料/00-软著申请计划.md"
	content, err := os.ReadFile(path)
	if err != nil {
		fmt.Printf("Warning: failed to read %s: %v\n", path, err)
		return
	}
	updated := strings.ReplaceAll(string(content), "软件版本: "+oldVer, "软件版本: "+newVer)
	updated = strings.ReplaceAll(updated, "软件版本号: "+oldVer, "软件版本号: "+newVer)
	updated = strings.ReplaceAll(updated, "source-code-"+oldVer+".pdf", "source-code-"+newVer+".pdf")
	
	err = os.WriteFile(path, []byte(updated), 0644)
	if err != nil {
		fmt.Printf("Error writing %s: %v\n", path, err)
	} else {
		fmt.Printf("Successfully updated %s\n", path)
	}
}

func updateApplicationForm(oldVer, newVer, owner string) {
	path := "软著申请材料/01-软件著作权登记申请表.md"
	content, err := os.ReadFile(path)
	if err != nil {
		fmt.Printf("Warning: failed to read %s: %v\n", path, err)
		return
	}
	updated := string(content)
	// Replace version
	updated = strings.ReplaceAll(updated, "### 3. 软件版本号\n"+oldVer, "### 3. 软件版本号\n"+newVer)
	updated = strings.ReplaceAll(updated, "局域网文件传输系统"+oldVer, "局域网文件传输系统"+newVer)
	// Replace copyright owner
	updated = strings.ReplaceAll(updated, "### 1. 著作权人\n**姓名/名称**: _______________（与申请人一致）", "### 1. 著作权人\n**姓名/名称**: "+owner)

	err = os.WriteFile(path, []byte(updated), 0644)
	if err != nil {
		fmt.Printf("Error writing %s: %v\n", path, err)
	} else {
		fmt.Printf("Successfully updated %s\n", path)
	}
}

func generateDesignDoc(oldVer, newVer, owner string) {
	srcPath := "软著申请材料/03-软件设计说明书.md"
	destPath := "软著申请材料/03-软件设计说明书-李跃龙.md"
	content, err := os.ReadFile(srcPath)
	if err != nil {
		fmt.Printf("Warning: failed to read %s: %v\n", srcPath, err)
		return
	}
	updated := string(content)
	
	// Inject owner and update version
	targetLine := "**软件版本**: " + oldVer
	replacement := "**软件版本**: " + newVer + "  \n**著作权人**: " + owner
	updated = strings.ReplaceAll(updated, targetLine, replacement)
	
	// Global title replacement
	updated = strings.ReplaceAll(updated, "局域网文件传输系统V1.0", "局域网文件传输系统"+newVer)

	err = os.WriteFile(destPath, []byte(updated), 0644)
	if err != nil {
		fmt.Printf("Error writing %s: %v\n", destPath, err)
	} else {
		fmt.Printf("Successfully generated %s\n", destPath)
	}
}

func generateUserDoc(oldVer, newVer, owner string) {
	srcPath := "软著申请材料/04-软件使用说明书.md"
	destPath := "软著申请材料/04-软件使用说明书-李跃龙.md"
	content, err := os.ReadFile(srcPath)
	if err != nil {
		fmt.Printf("Warning: failed to read %s: %v\n", srcPath, err)
		return
	}
	updated := string(content)
	
	// Inject owner and update version
	targetLine := "**软件版本**: " + oldVer
	replacement := "**软件版本**: " + newVer + "  \n**著作权人**: " + owner
	updated = strings.ReplaceAll(updated, targetLine, replacement)

	err = os.WriteFile(destPath, []byte(updated), 0644)
	if err != nil {
		fmt.Printf("Error writing %s: %v\n", destPath, err)
	} else {
		fmt.Printf("Successfully generated %s\n", destPath)
	}
}
