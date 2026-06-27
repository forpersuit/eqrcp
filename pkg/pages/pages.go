package pages

import _ "embed"

// QR page
//
//go:embed qr.tmpl.html
var QR string

// Chat page
//
//go:embed chat.tmpl.html
var Chat string

// Upload page
//
//go:embed upload.tmpl.html
var Upload string

// Done page
//
//go:embed done.tmpl.html
var Done string

// Download page
//
//go:embed download.tmpl.html
var Download string


// LogoMark is the browser-page product mark.
//
//go:embed assets/eqt-logo-mark.png
var LogoMark []byte

// LogoHorizontal is the browser-page horizontal brand logo.
//
//go:embed assets/eqt-logo-horizontal.png
var LogoHorizontal []byte

// Favicon is the browser-page favicon.
//
//go:embed assets/favicon.png
var Favicon []byte
