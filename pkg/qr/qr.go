package qr

import (
	"fmt"
	"image"

	"github.com/skip2/go-qrcode"
)

// RenderString as a QR code
func RenderString(s string, inverseColor bool) error {
	q, err := qrcode.New(s, qrcode.Medium)
	if err != nil {
		return err
	}
	fmt.Println(q.ToSmallString(inverseColor))
	return nil
}

// RenderImage returns a QR code as an image.Image
func RenderImage(s string) (image.Image, error) {
	q, err := qrcode.New(s, qrcode.Medium)
	if err != nil {
		return nil, err
	}
	return q.Image(256), nil
}
