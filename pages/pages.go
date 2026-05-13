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
