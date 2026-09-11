package main

import (
	"bytes"
	"encoding/binary"
	"image"
	"image/color"
	"image/png"
	"log"
	"math"
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
	horizontalSource := "docs/img/logo-design-horizontal.png"
	if len(os.Args) > 2 {
		horizontalSource = os.Args[2]
	}
	img := readPNG(source)
	writePNG("desktop/gui/build/appicon.png", resize(img, 1024))
	writePNG("desktop/gui/frontend/src/assets/images/logo-universal.png", resize(img, 32))
	writePNG("desktop/gui/frontend/src/assets/images/logo-mark.png", resize(img, 96))
	writePNG("desktop/gui/frontend/src/assets/images/favicon.png", resize(img, 32))
	writePNG("pkg/pages/assets/eqt-logo-mark.png", resize(img, 96))
	writePNG("pkg/pages/assets/favicon.png", resize(img, 32))
	writeICO("desktop/gui/build/windows/icon.ico", img, []int{256, 128, 64, 48, 32, 16})

	horizontal := readPNG(horizontalSource)
	// Tight lockup for About + browser brand surfaces.
	lockup := resizeToWidth(cropBrandLockup(horizontal), 512)
	writePNG("desktop/gui/frontend/src/assets/images/logo-horizontal.png", lockup)
	writePNG("pkg/pages/assets/eqt-logo-horizontal.png", lockup)
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
	return resizeTo(src, size, size)
}

func resizeToWidth(src image.Image, width int) image.Image {
	bounds := src.Bounds()
	if width <= 0 || bounds.Dx() <= 0 || bounds.Dy() <= 0 {
		return src
	}
	height := bounds.Dy() * width / bounds.Dx()
	if height < 1 {
		height = 1
	}
	return resizeTo(src, width, height)
}

func resizeTo(src image.Image, dstW, dstH int) image.Image {
	dst := image.NewNRGBA(image.Rect(0, 0, dstW, dstH))
	bounds := src.Bounds()
	srcW := float64(bounds.Dx())
	srcH := float64(bounds.Dy())

	xScale := srcW / float64(dstW)
	yScale := srcH / float64(dstH)

	for dy := 0; dy < dstH; dy++ {
		sy0 := float64(bounds.Min.Y) + float64(dy)*yScale
		sy1 := sy0 + yScale
		syMin := int(math.Floor(sy0))
		syMax := int(math.Ceil(sy1))
		if syMin < bounds.Min.Y {
			syMin = bounds.Min.Y
		}
		if syMax > bounds.Max.Y {
			syMax = bounds.Max.Y
		}

		for dx := 0; dx < dstW; dx++ {
			sx0 := float64(bounds.Min.X) + float64(dx)*xScale
			sx1 := sx0 + xScale
			sxMin := int(math.Floor(sx0))
			sxMax := int(math.Ceil(sx1))
			if sxMin < bounds.Min.X {
				sxMin = bounds.Min.X
			}
			if sxMax > bounds.Max.X {
				sxMax = bounds.Max.X
			}

			var sumR, sumG, sumB, sumA, totalWeight float64

			for sy := syMin; sy < syMax; sy++ {
				top := math.Max(sy0, float64(sy))
				bottom := math.Min(sy1, float64(sy+1))
				hOverlap := bottom - top
				if hOverlap <= 0 {
					continue
				}

				for sx := sxMin; sx < sxMax; sx++ {
					left := math.Max(sx0, float64(sx))
					right := math.Min(sx1, float64(sx+1))
					wOverlap := right - left
					if wOverlap <= 0 {
						continue
					}

					weight := wOverlap * hOverlap
					r, g, b, a := src.At(sx, sy).RGBA()
					sumR += float64(r) * weight
					sumG += float64(g) * weight
					sumB += float64(b) * weight
					sumA += float64(a) * weight
					totalWeight += weight
				}
			}

			if totalWeight > 0 && sumA > 0 {
				avgA := sumA / totalWeight
				avgR := (sumR / totalWeight) / avgA * 255.0
				avgG := (sumG / totalWeight) / avgA * 255.0
				avgB := (sumB / totalWeight) / avgA * 255.0
				finalA := avgA / 65535.0 * 255.0

				dst.SetNRGBA(dx, dy, color.NRGBA{
					R: uint8(math.Min(255, math.Max(0, math.Round(avgR)))),
					G: uint8(math.Min(255, math.Max(0, math.Round(avgG)))),
					B: uint8(math.Min(255, math.Max(0, math.Round(avgB)))),
					A: uint8(math.Min(255, math.Max(0, math.Round(finalA)))),
				})
			}
		}
	}
	return dst
}

// cropBrandLockup trims empty margins so About / page logos keep only the brand mark.
// Works with the current transparent lockup source (and any similar tight horizontal art).
func cropBrandLockup(src image.Image) image.Image {
	bounds := src.Bounds()
	minX, minY := bounds.Max.X, bounds.Max.Y
	maxX, maxY := bounds.Min.X-1, bounds.Min.Y-1
	found := false
	for y := bounds.Min.Y; y < bounds.Max.Y; y++ {
		for x := bounds.Min.X; x < bounds.Max.X; x++ {
			_, _, _, a := src.At(x, y).RGBA()
			if a < 0x1000 {
				continue
			}
			found = true
			if x < minX {
				minX = x
			}
			if y < minY {
				minY = y
			}
			if x > maxX {
				maxX = x
			}
			if y > maxY {
				maxY = y
			}
		}
	}
	if !found {
		return src
	}
	// Keep a small breathing margin around the mark.
	padX := (maxX - minX + 1) * 3 / 100
	padY := (maxY - minY + 1) * 3 / 100
	if padX < 4 {
		padX = 4
	}
	if padY < 4 {
		padY = 4
	}
	return crop(src, image.Rect(minX-padX, minY-padY, maxX+1+padX, maxY+1+padY))
}

func crop(src image.Image, rect image.Rectangle) image.Image {
	rect = rect.Intersect(src.Bounds())
	dst := image.NewNRGBA(image.Rect(0, 0, rect.Dx(), rect.Dy()))
	for y := 0; y < rect.Dy(); y++ {
		for x := 0; x < rect.Dx(); x++ {
			dst.Set(x, y, src.At(rect.Min.X+x, rect.Min.Y+y))
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
		_, err := file.Write([]byte{width, width, 0, 0})
		must(err)
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
