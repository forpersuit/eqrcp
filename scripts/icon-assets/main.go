package main

import (
	"bytes"
	"encoding/binary"
	"image"
	"image/png"
	"log"
	"os"
	"path/filepath"
)

type icoEntry struct {
	size int
	data []byte
}

func main() {
	source := "docs/img/transparent.png"
	if len(os.Args) > 1 {
		source = os.Args[1]
	}
	img := readPNG(source)
	writePNG("desktop/gui/build/appicon.png", resize(img, 1024))
	writePNG("desktop/gui/frontend/src/assets/images/logo-universal.png", resize(img, 256))
	writePNG("desktop/gui/frontend/src/assets/images/logo-mark.png", resize(img, 96))
	writePNG("desktop/gui/frontend/src/assets/images/favicon.png", resize(img, 32))
	writePNG("pages/assets/eqt-logo-mark.png", resize(img, 96))
	writePNG("pages/assets/favicon.png", resize(img, 32))
	writeICO("desktop/gui/build/windows/icon.ico", img, []int{256, 128, 64, 48, 32, 16})
}

func readPNG(path string) image.Image {
	file, err := os.Open(path)
	if err != nil {
		log.Fatal(err)
	}
	defer file.Close()
	img, _, err := image.Decode(file)
	if err != nil {
		log.Fatal(err)
	}
	return img
}

func resize(src image.Image, size int) image.Image {
	dst := image.NewNRGBA(image.Rect(0, 0, size, size))
	bounds := src.Bounds()
	for y := 0; y < size; y++ {
		for x := 0; x < size; x++ {
			sx := bounds.Min.X + x*bounds.Dx()/size
			sy := bounds.Min.Y + y*bounds.Dy()/size
			dst.Set(x, y, src.At(sx, sy))
		}
	}
	return dst
}

func writePNG(path string, img image.Image) {
	if err := os.MkdirAll(filepath.Dir(path), 0755); err != nil {
		log.Fatal(err)
	}
	file, err := os.Create(path)
	if err != nil {
		log.Fatal(err)
	}
	defer file.Close()
	if err := png.Encode(file, img); err != nil {
		log.Fatal(err)
	}
}

func writeICO(path string, src image.Image, sizes []int) {
	if err := os.MkdirAll(filepath.Dir(path), 0755); err != nil {
		log.Fatal(err)
	}
	entries := make([]icoEntry, 0, len(sizes))
	for _, size := range sizes {
		var buf bytes.Buffer
		if err := png.Encode(&buf, resize(src, size)); err != nil {
			log.Fatal(err)
		}
		entries = append(entries, icoEntry{size: size, data: buf.Bytes()})
	}
	file, err := os.Create(path)
	if err != nil {
		log.Fatal(err)
	}
	defer file.Close()
	must(binary.Write(file, binary.LittleEndian, uint16(0)))
	must(binary.Write(file, binary.LittleEndian, uint16(1)))
	must(binary.Write(file, binary.LittleEndian, uint16(len(entries))))
	offset := uint32(6 + len(entries)*16)
	for _, entry := range entries {
		width := byte(entry.size)
		if entry.size == 256 {
			width = 0
		}
		file.Write([]byte{width, width, 0, 0})
		must(binary.Write(file, binary.LittleEndian, uint16(1)))
		must(binary.Write(file, binary.LittleEndian, uint16(32)))
		must(binary.Write(file, binary.LittleEndian, uint32(len(entry.data))))
		must(binary.Write(file, binary.LittleEndian, offset))
		offset += uint32(len(entry.data))
	}
	for _, entry := range entries {
		_, err := file.Write(entry.data)
		must(err)
	}
}

func must(err error) {
	if err != nil {
		log.Fatal(err)
	}
}
